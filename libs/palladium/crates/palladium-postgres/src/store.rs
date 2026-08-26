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
fn migration_queries(table: &str) -> [String; 3] {
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
    ]
}

// ── Store ─────────────────────────────────────────────────────────────────

/// `PostgreSQL`-backed persistent store for [`Change`]s.
#[derive(Debug)]
pub struct PostgresStore {
    pool: PgPool,
    table: String,
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
        if matches!(isolation, PostgresIsolation::Schema) {
            sqlx::query(&format!(
                "CREATE SCHEMA IF NOT EXISTS {}",
                quote_identifier(schema)?
            ))
            .execute(&pool)
            .await?;
        }
        Self::migrate_table(&pool, &table).await?;
        Ok(Self {
            pool,
            table,
            _open_guard: Some(guard),
        })
    }

    /// Construct a public-schema store from an already-configured pool.
    #[must_use]
    pub fn from_pool(pool: PgPool) -> Self {
        Self {
            pool,
            table: format!("\"public\".\"{CHANGE_TABLE}\""),
            _open_guard: None,
        }
    }

    /// Migrate the default `public` schema change table.
    ///
    /// # Errors
    /// Returns an error if the migration statements fail.
    pub async fn migrate(pool: &PgPool) -> Result<()> {
        Self::migrate_table(pool, &format!("\"public\".\"{CHANGE_TABLE}\"")).await
    }

    async fn migrate_table(pool: &PgPool, table: &str) -> Result<()> {
        for query in migration_queries(table) {
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
    ) -> std::result::Result<palladium_core::InsertOutcome, Error> {
        palladium_core::validate_v1_change(change).map_err(Error::InvalidData)?;
        let payload = palladium_core::canonical_change_bytes(change)?;
        let hash = format!("{:x}", sha2::Sha256::digest(&payload));
        let millis = i64::try_from(change.hlc.millis())
            .map_err(|_| Error::InvalidData("hlc millis overflow".into()))?;
        let ops_json = serde_json::to_value(&change.ops)?;
        let mut tx = self.pool.begin().await?;
        let inserted: Option<(i64,)> = sqlx::query_as(&format!("INSERT INTO {} (id,scope,hlc_millis,hlc_counter,hlc_node_id,ops_json,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (scope,id) DO NOTHING RETURNING append_seq", self.table))
            .bind(change.id).bind(scope.as_str()).bind(millis).bind(i64::from(change.hlc.counter())).bind(change.hlc.node_id().to_string()).bind(ops_json).bind(&hash)
            .fetch_optional(&mut *tx).await?;
        let (seq, inserted) = if let Some((seq,)) = inserted {
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
// `#[sqlx::test]`. They only run when `DATABASE_URL` is set in the
// environment (e.g. in CI).

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "integration-tests")]
    use palladium_core::{Change, ChangeStore, Hlc, InsertOutcome, NodeId, Scope};
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
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return Ok(());
        };
        let store = Arc::new(PostgresStore::connect(&url).await?);
        let scope = Scope::new(format!("concurrency-{}", Uuid::new_v4()));
        let change = Change::new(Hlc::new(NodeId::from_uuid(Uuid::nil()), 1), vec![]);
        let barrier = Arc::new(Barrier::new(2));

        let insert = |store: Arc<PostgresStore>| {
            let barrier = Arc::clone(&barrier);
            let scope = scope.clone();
            let change = change.clone();
            async move {
                barrier.wait().await;
                store.insert(&scope, &change).await
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
}
