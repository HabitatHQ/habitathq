//! [`PostgresStore`] — `PostgreSQL`-backed [`ChangeStore`] implementation.

use palladium_core::{Change, ChangeStore, Hlc, InstanceConfig, Op, PostgresIsolation, Scope};
use sha2::Digest;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{Error, Result};

// ── Identifier validation ─────────────────────────────────────────────────

/// Validate that `name` is a safe SQL identifier.
///
/// Allowed characters: ASCII letters, ASCII digits, and underscore `_`.
/// Must start with a letter or underscore (not a digit).
///
/// # Errors
/// Returns [`Error::InvalidIdentifier`] if the name is empty, starts with a
/// digit, or contains characters outside `[a-zA-Z0-9_]`.
pub fn validate_identifier(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(Error::InvalidIdentifier(name.to_owned()));
    }
    let mut chars = name.chars();
    // First character must be a letter or underscore.
    if let Some(first) = chars.next() {
        if !first.is_ascii_alphabetic() && first != '_' {
            return Err(Error::InvalidIdentifier(name.to_owned()));
        }
    }
    // Remaining characters may be alphanumeric or underscore.
    if chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(())
    } else {
        Err(Error::InvalidIdentifier(name.to_owned()))
    }
}

// ── Schema migration ──────────────────────────────────────────────────────

const CHANGE_TABLE: &str = "palladium_changes";
const SCOPE_LOCK_TABLE: &str = "palladium_scope_locks";

fn quote_identifier(name: &str) -> Result<String> {
    validate_identifier(name)?;
    Ok(format!("\"{name}\""))
}

fn change_table(schema: &str) -> Result<String> {
    Ok(format!(
        "{}.{}",
        quote_identifier(schema)?,
        quote_identifier(CHANGE_TABLE)?
    ))
}
fn scope_lock_table(schema: &str) -> Result<String> {
    Ok(format!(
        "{}.{}",
        quote_identifier(schema)?,
        quote_identifier(SCOPE_LOCK_TABLE)?
    ))
}

fn migration_queries(table: &str, scope_lock_table: &str) -> [String; 4] {
    [
        format!(
            "CREATE TABLE IF NOT EXISTS {table} (
            append_seq BIGSERIAL PRIMARY KEY,
            id UUID NOT NULL,
            scope TEXT NOT NULL,
            hlc_millis BIGINT NOT NULL,
            hlc_counter BIGINT NOT NULL,
            hlc_node_id TEXT NOT NULL,
            ops_json JSONB NOT NULL,
            payload_hash TEXT NOT NULL,
            UNIQUE(scope,id)
        )"
        ),
        format!("CREATE INDEX IF NOT EXISTS idx_changes_scope_append ON {table}(scope,append_seq)"),
        format!("CREATE INDEX IF NOT EXISTS idx_changes_scope_id ON {table}(scope,id)"),
        format!(
            "CREATE TABLE IF NOT EXISTS {scope_lock_table} (
                scope TEXT PRIMARY KEY
            )"
        ),
    ]
}

// ── Store ─────────────────────────────────────────────────────────────────

/// `PostgreSQL`-backed persistent store for [`Change`]s.
#[derive(Debug)]
pub struct PostgresStore {
    pool: PgPool,
    table: String,
    scope_lock_table: String,
    _open_guard: Option<palladium_core::OpenGuard>,
}

impl PostgresStore {
    /// Connect to the default `public` schema and migrate its change table.
    ///
    /// # Errors
    /// Returns an error if the connection, instance registration, or migration fails.
    pub async fn connect(url: &str) -> Result<Self> {
        let guard = palladium_core::register(url)?;
        let pool = PgPool::connect(url).await?;
        Self::migrate(&pool).await?;
        Ok(Self {
            pool,
            table: format!("\"public\".\"{CHANGE_TABLE}\""),
            scope_lock_table: format!("\"public\".\"{SCOPE_LOCK_TABLE}\""),
            _open_guard: Some(guard),
        })
    }

    /// Connect with instance isolation and migrate that instance's change table.
    ///
    /// # Errors
    /// Returns an error if configuration validation, connection, registration, or migration fails.
    pub async fn connect_with_config(cfg: &InstanceConfig) -> Result<Self> {
        let guard = palladium_core::register(&cfg.path)?;
        let postgres_opts = cfg.postgres.as_ref();
        let isolation = postgres_opts.map_or(&PostgresIsolation::Schema, |p| &p.isolation);
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(cfg.limits.pool_size)
            .acquire_timeout(std::time::Duration::from_secs(
                cfg.limits.acquire_timeout_secs,
            ))
            .idle_timeout(std::time::Duration::from_secs(cfg.limits.idle_timeout_secs))
            .connect(&cfg.path)
            .await?;
        let schema = match isolation {
            PostgresIsolation::Schema => postgres_opts
                .and_then(|p| p.schema.as_deref())
                .unwrap_or(&cfg.name),
            PostgresIsolation::Db => "public",
        };
        let table = change_table(schema)?;
        let lock_table = scope_lock_table(schema)?;
        if matches!(isolation, PostgresIsolation::Schema) {
            sqlx::query(&format!(
                "CREATE SCHEMA IF NOT EXISTS {}",
                quote_identifier(schema)?
            ))
            .execute(&pool)
            .await?;
        }
        Self::migrate_table(&pool, &table, &lock_table).await?;
        Ok(Self {
            pool,
            table,
            scope_lock_table: lock_table,
            _open_guard: Some(guard),
        })
    }

    /// Construct a public-schema store from an already-configured pool.
    #[must_use]
    pub fn from_pool(pool: PgPool) -> Self {
        Self {
            pool,
            table: format!("\"public\".\"{CHANGE_TABLE}\""),
            scope_lock_table: format!("\"public\".\"{SCOPE_LOCK_TABLE}\""),
            _open_guard: None,
        }
    }

    /// Migrate the default `public` schema change table.
    ///
    /// # Errors
    /// Returns an error if the migration statements fail.
    pub async fn migrate(pool: &PgPool) -> Result<()> {
        let table = format!("\"public\".\"{CHANGE_TABLE}\"");
        let lock_table = format!("\"public\".\"{SCOPE_LOCK_TABLE}\"");
        Self::migrate_table(pool, &table, &lock_table).await
    }

    async fn migrate_table(pool: &PgPool, table: &str, lock_table: &str) -> Result<()> {
        for query in migration_queries(table, lock_table) {
            sqlx::query(&query).execute(pool).await?;
        }
        Ok(())
    }
}

// ── ChangeStore impl ──────────────────────────────────────────────────────

impl ChangeStore for PostgresStore {
    type Error = Error;
    async fn insert(
        &self,
        scope: &Scope,
        change: &Change,
        now_millis: u64,
    ) -> std::result::Result<palladium_core::InsertOutcome, Error> {
        palladium_core::validate_structure(change).map_err(Error::InvalidData)?;
        let payload = palladium_core::canonical_change_bytes(change)?;
        let hash = format!("{:x}", sha2::Sha256::digest(&payload));
        let millis = i64::try_from(change.hlc.millis()).unwrap_or(i64::MAX);
        let ops_json = serde_json::to_value(&change.ops)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(&format!(
            "INSERT INTO {} (scope) VALUES ($1) ON CONFLICT (scope) DO NOTHING",
            self.scope_lock_table
        ))
        .bind(scope.as_str())
        .execute(&mut *tx)
        .await?;
        sqlx::query(&format!(
            "SELECT scope FROM {} WHERE scope=$1 FOR UPDATE",
            self.scope_lock_table
        ))
        .bind(scope.as_str())
        .fetch_one(&mut *tx)
        .await?;
        let inserted: Option<(i64,)> = sqlx::query_as(&format!("INSERT INTO {} (id,scope,hlc_millis,hlc_counter,hlc_node_id,ops_json,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (scope,id) DO NOTHING RETURNING append_seq", self.table))
            .bind(change.id).bind(scope.as_str()).bind(millis).bind(i64::from(change.hlc.counter())).bind(change.hlc.node_id().to_string()).bind(ops_json).bind(&hash)
            .fetch_optional(&mut *tx).await?;
        let (seq, inserted) = if let Some((seq,)) = inserted {
            if change.hlc.millis() > i64::MAX.unsigned_abs()
                || change.hlc.millis()
                    > now_millis.saturating_add(palladium_core::V1_MAX_FUTURE_HLC_MILLIS)
            {
                return Err(Error::InvalidData("clock_skew".into()));
            }
            (seq, true)
        } else {
            let (seq, existing): (i64, String) = sqlx::query_as(&format!(
                "SELECT append_seq,payload_hash FROM {} WHERE scope=$1 AND id=$2",
                self.table
            ))
            .bind(scope.as_str())
            .bind(change.id)
            .fetch_one(&mut *tx)
            .await?;
            if existing != hash {
                return Err(Error::InvalidData("change_conflict".into()));
            }
            (seq, false)
        };
        tx.commit().await?;
        let seq = u64::try_from(seq)
            .map_err(|_| Error::InvalidData("append sequence is negative".into()))?;
        let cursor = palladium_core::AppendCursor::new(seq);
        Ok(if inserted {
            palladium_core::InsertOutcome::Inserted(cursor)
        } else {
            palladium_core::InsertOutcome::Duplicate(cursor)
        })
    }
    async fn page(
        &self,
        scope: &Scope,
        after: Option<&palladium_core::AppendCursor>,
        limit: u32,
    ) -> std::result::Result<palladium_core::ChangePage, Error> {
        let limit = limit.clamp(1, palladium_core::MAX_PAGE_SIZE);
        let upper_db: (i64,) = sqlx::query_as(&format!(
            "SELECT COALESCE(MAX(append_seq),0) FROM {} WHERE scope=$1",
            self.table
        ))
        .bind(scope.as_str())
        .fetch_one(&self.pool)
        .await?;
        let upper = u64::try_from(upper_db.0)
            .map_err(|_| Error::InvalidData("append sequence is negative".into()))?;
        let start = after.map_or(0, palladium_core::AppendCursor::position);
        let start_db = i64::try_from(start)
            .map_err(|_| Error::InvalidData("append cursor exceeds database range".into()))?;
        let rows: Vec<ChangeRow> = sqlx::query_as(&format!("SELECT append_seq,id,hlc_millis,hlc_counter,hlc_node_id,ops_json FROM {} WHERE scope=$1 AND append_seq>$2 AND append_seq<=$3 ORDER BY append_seq LIMIT $4", self.table))
            .bind(scope.as_str()).bind(start_db).bind(upper_db.0).bind(i64::from(limit)).fetch_all(&self.pool).await?;
        let cursor = rows
            .last()
            .map(|row| {
                u64::try_from(row.append_seq)
                    .map(palladium_core::AppendCursor::new)
                    .map_err(|_| Error::InvalidData("append sequence is negative".into()))
            })
            .transpose()?;
        let changes = rows
            .into_iter()
            .map(ChangeRow::try_into_change)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let caught_up = cursor
            .as_ref()
            .map_or(start >= upper, |c| c.position() >= upper);
        Ok(palladium_core::ChangePage {
            version: 1,
            changes,
            purges: Vec::new(),
            events: Vec::new(),
            cursor,
            upper_bound: palladium_core::AppendCursor::new(upper.max(1)),
            caught_up,
            control: palladium_core::PageControl {
                must_refetch: false,
            },
        })
    }
    async fn get(&self, scope: &Scope, id: Uuid) -> std::result::Result<Option<Change>, Error> {
        let row: Option<ChangeRow> = sqlx::query_as(&format!("SELECT append_seq,id,hlc_millis,hlc_counter,hlc_node_id,ops_json FROM {} WHERE id=$1 AND scope=$2", self.table)).bind(id).bind(scope.as_str()).fetch_optional(&self.pool).await?;
        row.map(ChangeRow::try_into_change).transpose()
    }
}

#[derive(sqlx::FromRow)]
struct ChangeRow {
    append_seq: i64,
    id: Uuid,
    hlc_millis: i64,
    hlc_counter: i64,
    hlc_node_id: String,
    ops_json: serde_json::Value,
}

impl ChangeRow {
    fn try_into_change(self) -> Result<Change> {
        let hlc = Hlc::from_db_parts(self.hlc_millis, self.hlc_counter, &self.hlc_node_id)
            .map_err(Error::InvalidData)?;
        let ops: Vec<Op> = serde_json::from_value(self.ops_json)?;
        Ok(Change {
            id: self.id,
            hlc,
            ops,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────
//
// Integration tests that require a live Postgres instance are gated behind
// `#[sqlx::test]` and the `integration-tests` feature. When that feature is
// enabled, `DATABASE_URL` is required rather than silently skipping coverage.

#[cfg(test)]
mod tests {
    #[cfg(feature = "integration-tests")]
    use super::*;
    #[cfg(feature = "integration-tests")]
    use palladium_core::{Change, ChangeStore, Hlc, InsertOutcome, NodeId, Op, Scope};
    #[cfg(feature = "integration-tests")]
    use serde_json::json;
    #[cfg(feature = "integration-tests")]
    use sqlx::ConnectOptions;
    #[cfg(feature = "integration-tests")]
    use std::sync::Arc;
    #[cfg(feature = "integration-tests")]
    use tokio::sync::Barrier;
    #[cfg(feature = "integration-tests")]
    use uuid::Uuid;

    // ── Identifier validator (no live connection needed) ──────────────────

    #[test]
    fn valid_identifier_accepted() {
        assert!(super::validate_identifier("valid_name").is_ok());
        assert!(super::validate_identifier("schema_2").is_ok());
        assert!(super::validate_identifier("_underscore").is_ok());
        assert!(super::validate_identifier("CamelCase").is_ok());
    }

    #[test]
    fn invalid_identifier_rejected() {
        assert!(super::validate_identifier("bad-name").is_err());
        assert!(super::validate_identifier("bad name").is_err());
        assert!(super::validate_identifier("").is_err());
        assert!(super::validate_identifier("1starts_with_digit").is_err());
        assert!(super::validate_identifier("semi;colon").is_err());
    }

    #[cfg(feature = "integration-tests")]
    /// Concurrent retries of one scoped change are idempotent, rather than
    /// leaking a unique-constraint error from one transaction.
    #[tokio::test]
    async fn concurrent_identical_scoped_inserts_return_inserted_and_duplicate(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let url = std::env::var("DATABASE_URL").map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "DATABASE_URL is required when integration-tests is enabled",
            )
        })?;
        let store = Arc::new(PostgresStore::connect(&url).await?);
        let scope = Scope::new(format!("concurrency-{}", Uuid::new_v4()));
        let row_id = Uuid::now_v7();
        let change = Change::new(
            Hlc::new(NodeId::new(), 1),
            vec![Op::Insert {
                table: "todos".into(),
                row_id,
                data: json!({"id": row_id}),
            }],
        );
        let barrier = Arc::new(Barrier::new(2));

        let insert = |store: Arc<PostgresStore>| {
            let barrier = Arc::clone(&barrier);
            let scope = scope.clone();
            let change = change.clone();
            async move {
                barrier.wait().await;
                store.insert(&scope, &change, u64::MAX).await
            }
        };
        let (left, right) = tokio::join!(insert(Arc::clone(&store)), insert(store));
        let outcomes = [left?, right?];
        assert!(outcomes
            .iter()
            .any(|outcome| matches!(outcome, InsertOutcome::Inserted(_))));
        assert!(outcomes
            .iter()
            .any(|outcome| matches!(outcome, InsertOutcome::Duplicate(_))));
        Ok(())
    }

    #[cfg(feature = "integration-tests")]
    #[sqlx::test]
    async fn accepted_retry_survives_clock_rollback_without_admitting_new_future_writes(
        pool: sqlx::PgPool,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy();
        let store = PostgresStore::connect(url.as_str()).await?;
        let scope = Scope::new(format!("clock-{}", Uuid::new_v4()));
        let row_id = Uuid::now_v7();
        let time = 1_700_000_000_000;
        let change = Change::new(
            Hlc::new(NodeId::new(), time),
            vec![Op::Insert {
                table: "notes".into(),
                row_id,
                data: json!({"id": row_id, "title": "accepted"}),
            }],
        );
        let cursor = match store.insert(&scope, &change, time).await? {
            InsertOutcome::Inserted(cursor) => cursor,
            InsertOutcome::Duplicate(_) => {
                return Err("first insert was unexpectedly duplicate".into())
            }
        };
        assert_eq!(
            store.insert(&scope, &change, 0).await?,
            InsertOutcome::Duplicate(cursor)
        );
        let mut conflicting = change.clone();
        conflicting.ops = vec![Op::Insert {
            table: "notes".into(),
            row_id,
            data: json!({"id": row_id, "title": "changed payload"}),
        }];
        match store.insert(&scope, &conflicting, 0).await {
            Err(error) => assert!(error.to_string().contains("change_conflict")),
            Ok(_) => return Err("conflicting retry was accepted".into()),
        }
        let fresh = Change::new(change.hlc, change.ops.clone());
        match store.insert(&scope, &fresh, 0).await {
            Err(error) => assert!(error.to_string().contains("clock_skew")),
            Ok(_) => return Err("fresh future write was accepted".into()),
        }
        assert_eq!(store.get(&scope, change.id).await?, Some(change));
        assert_eq!(store.get(&scope, fresh.id).await?, None);
        Ok(())
    }

    #[cfg(feature = "integration-tests")]
    #[sqlx::test]
    async fn invalid_insert_data_does_not_advance_postgres_history(
        pool: sqlx::PgPool,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        PostgresStore::migrate(&pool).await?;
        let store = PostgresStore::from_pool(pool);
        let scope = Scope::new(format!("invalid-insert-{}", Uuid::new_v4()));
        let row_id = Uuid::parse_str("018f0f50-7b8d-7a1c-8e2f-1234567890ab")?;
        let malformed = [
            serde_json::Value::Null,
            json!("scalar"),
            json!([{"id": row_id}]),
            json!({"title": "missing"}),
            json!({"id": "018f0f50-7b8d-7a1c-8e2f-1234567890ac"}),
            json!({"id": "018F0F50-7B8D-7A1C-8E2F-1234567890AB"}),
        ];
        for data in malformed {
            let change = Change::new(
                Hlc::new(NodeId::new(), 1),
                vec![Op::Insert {
                    table: "todos".into(),
                    row_id,
                    data,
                }],
            );
            assert!(matches!(
                store.insert(&scope, &change, u64::MAX).await,
                Err(Error::InvalidData(_))
            ));
            let page = store.page(&scope, None, 10).await?;
            assert_eq!(page.changes, Vec::<Change>::new());
            assert!(page.cursor.is_none());
        }

        let valid = Change::new(
            Hlc::new(NodeId::new(), 2),
            vec![Op::Insert {
                table: "todos".into(),
                row_id,
                data: json!({"id": row_id, "nested": {"values": [1, null, true]}}),
            }],
        );
        store.insert(&scope, &valid, u64::MAX).await?;
        let page = store.page(&scope, None, 10).await?;
        assert_eq!(page.changes, vec![valid]);
        assert_eq!(page.cursor.map(|cursor| cursor.position()), Some(1));
        Ok(())
    }
    #[cfg(feature = "integration-tests")]
    #[sqlx::test]
    async fn scoped_appends_serialize_before_sequence_allocation(
        pool: sqlx::PgPool,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        use std::time::Duration;
        use tokio::time::{sleep, timeout, Instant};

        let url = pool.connect_options().to_url_lossy();
        let store = Arc::new(PostgresStore::connect(url.as_str()).await?);
        let scope = Scope::new(format!("append-order-{}", Uuid::new_v4()));
        let other_scope = Scope::new(format!("append-other-{}", Uuid::new_v4()));
        let gate = format!("palladium_gate_{}", Uuid::now_v7().simple());
        let function = format!("{gate}_fn");
        let trigger = quote_identifier(&format!("{gate}_trigger"))?;
        let function_name = format!("\"public\".\"{function}\"");
        let scope_literal = scope.as_str().replace('\'', "''");
        let mut controller = pool.acquire().await?;
        sqlx::query("SELECT pg_advisory_lock(hashtext($1))")
            .bind(&gate)
            .execute(&mut *controller)
            .await?;
        sqlx::query(&format!(
            "CREATE FUNCTION {function_name}() RETURNS trigger LANGUAGE plpgsql AS $body$
             BEGIN
               IF NEW.scope = '{scope_literal}' AND NEW.hlc_millis = 1 THEN
                 WHILE NOT pg_try_advisory_lock(hashtext('{gate}')) LOOP
                   PERFORM pg_sleep(0.01);
                 END LOOP;
                 PERFORM pg_advisory_unlock(hashtext('{gate}'));
               END IF;
               RETURN NEW;
             END
             $body$"
        ))
        .execute(&pool)
        .await?;
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger} AFTER INSERT ON {} FOR EACH ROW EXECUTE FUNCTION {function_name}()",
            store.table
        ))
        .execute(&pool)
        .await?;
        let make_change = |millis| {
            let row_id = Uuid::now_v7();
            Change::new(
                Hlc::new(NodeId::new(), millis),
                vec![Op::Insert {
                    table: "todos".into(),
                    row_id,
                    data: json!({"id": row_id}),
                }],
            )
        };
        let a = make_change(1);
        let b = make_change(2);
        let other = make_change(3);
        let first_store = Arc::clone(&store);
        let first_scope = scope.clone();
        let first_change = a.clone();
        let first = tokio::spawn(async move {
            first_store
                .insert(&first_scope, &first_change, u64::MAX)
                .await
        });
        timeout(Duration::from_secs(5), async {
            loop {
                let in_trigger: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                     WHERE datname = current_database() AND wait_event = 'PgSleep'
                       AND query ILIKE '%INSERT INTO%palladium_changes%')",
                )
                .fetch_one(&pool)
                .await?;
                if in_trigger {
                    return Ok::<(), sqlx::Error>(());
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "writer A did not reach post-allocation trigger")??;
        let second_store = Arc::clone(&store);
        let second_scope = scope.clone();
        let second_change = b.clone();
        let second = tokio::spawn(async move {
            second_store
                .insert(&second_scope, &second_change, u64::MAX)
                .await
        });
        assert!(matches!(
            store.insert(&other_scope, &other, u64::MAX).await?,
            InsertOutcome::Inserted(_)
        ));
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut lock_wait = false;
        while Instant::now() < deadline && !second.is_finished() {
            lock_wait |= sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                 WHERE datname = current_database() AND wait_event_type = 'Lock'
                   AND (query ILIKE '%palladium_scope_locks%' OR query ILIKE '%palladium_changes%'))",
            )
            .fetch_one(&pool)
            .await?;
            if lock_wait {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
        let b_published_early = second.is_finished();
        let early_page = if b_published_early {
            Some(store.page(&scope, None, 100).await?)
        } else {
            None
        };
        sqlx::query("SELECT pg_advisory_unlock(hashtext($1))")
            .bind(&gate)
            .execute(&mut *controller)
            .await?;
        let cursor_a = match timeout(Duration::from_secs(5), first).await??? {
            InsertOutcome::Inserted(cursor) => cursor,
            InsertOutcome::Duplicate(_) => return Err("A was unexpectedly duplicate".into()),
        };
        let cursor_b = match timeout(Duration::from_secs(5), second).await??? {
            InsertOutcome::Inserted(cursor) => cursor,
            InsertOutcome::Duplicate(_) => return Err("B was unexpectedly duplicate".into()),
        };
        if let Some(page) = early_page {
            let cursor = page.cursor.as_ref().ok_or("early page lacks its cursor")?;
            let later = store.page(&scope, Some(cursor), 100).await?;
            assert!(
                later.changes.contains(&a),
                "same-scope page checkpointed B and permanently omitted later-committed A"
            );
        }
        assert!(
            !b_published_early && lock_wait,
            "B must wait for A's transaction"
        );
        assert!(cursor_a.position() < cursor_b.position());
        let retry = store.insert(&scope, &a, 0).await?;
        assert_eq!(
            store.page(&scope, None, 100).await?.changes,
            vec![a.clone(), b.clone()]
        );
        assert_eq!(
            store.page(&scope, Some(&cursor_a), 100).await?.changes,
            vec![b]
        );
        assert_eq!(retry, InsertOutcome::Duplicate(cursor_a));
        assert_eq!(
            store.page(&other_scope, None, 100).await?.changes,
            vec![other]
        );
        sqlx::query(&format!("DROP TRIGGER {trigger} ON {}", store.table))
            .execute(&pool)
            .await?;
        sqlx::query(&format!("DROP FUNCTION {function_name}()"))
            .execute(&pool)
            .await?;
        Ok(())
    }
    #[cfg(feature = "integration-tests")]
    #[sqlx::test]
    async fn rolled_back_scope_append_releases_the_scope_lock(
        pool: sqlx::PgPool,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        use std::time::Duration;
        use tokio::time::timeout;

        let url = pool.connect_options().to_url_lossy();
        let store = PostgresStore::connect(url.as_str()).await?;
        let scope = Scope::new(format!("append-rollback-{}", Uuid::new_v4()));
        let function = format!("palladium_rollback_{}_fn", Uuid::now_v7().simple());
        let trigger = quote_identifier(&format!("{function}_trigger"))?;
        let function_name = format!("\"public\".\"{function}\"");
        let scope_literal = scope.as_str().replace('\'', "''");
        sqlx::query(&format!(
            "CREATE FUNCTION {function_name}() RETURNS trigger LANGUAGE plpgsql AS $body$
             BEGIN
               IF NEW.scope = '{scope_literal}' AND NEW.hlc_millis = 11 THEN
                 RAISE EXCEPTION 'test rollback';
               END IF;
               RETURN NEW;
             END
             $body$"
        ))
        .execute(&pool)
        .await?;
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger} AFTER INSERT ON {} FOR EACH ROW EXECUTE FUNCTION {function_name}()",
            store.table
        ))
        .execute(&pool)
        .await?;
        let make_change = |millis| {
            let row_id = Uuid::now_v7();
            Change::new(
                Hlc::new(NodeId::new(), millis),
                vec![Op::Insert {
                    table: "todos".into(),
                    row_id,
                    data: json!({"id": row_id}),
                }],
            )
        };
        let rolled_back = make_change(11);
        let accepted = make_change(12);
        assert!(store.insert(&scope, &rolled_back, u64::MAX).await.is_err());
        assert!(matches!(
            timeout(
                Duration::from_secs(5),
                store.insert(&scope, &accepted, u64::MAX)
            )
            .await??,
            InsertOutcome::Inserted(_)
        ));
        assert_eq!(store.page(&scope, None, 10).await?.changes, vec![accepted]);
        sqlx::query(&format!("DROP TRIGGER {trigger} ON {}", store.table))
            .execute(&pool)
            .await?;
        sqlx::query(&format!("DROP FUNCTION {function_name}()"))
            .execute(&pool)
            .await?;
        Ok(())
    }
}
