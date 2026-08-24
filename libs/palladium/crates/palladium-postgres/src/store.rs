//! [`PostgresStore`] — `PostgreSQL`-backed [`ChangeStore`] implementation.

use palladium_core::{Change, ChangeStore, Hlc, InstanceConfig, Op, PostgresIsolation, Scope};
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

const DEFAULT_SCOPE: &str = "default";
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

fn migration_queries(table: &str) -> [String; 5] {
    [
        format!(
            "CREATE TABLE IF NOT EXISTS {table} (
                id          UUID    NOT NULL PRIMARY KEY,
                scope       TEXT    NOT NULL,
                hlc_key     TEXT    NOT NULL,
                hlc_millis  BIGINT  NOT NULL,
                hlc_counter BIGINT  NOT NULL,
                hlc_node_id TEXT    NOT NULL,
                ops_json    JSONB   NOT NULL
            )"
        ),
        format!("ALTER TABLE {table} ADD COLUMN IF NOT EXISTS scope TEXT"),
        format!("UPDATE {table} SET scope = $1 WHERE scope IS NULL"),
        format!("ALTER TABLE {table} ALTER COLUMN scope SET NOT NULL"),
        format!("CREATE INDEX IF NOT EXISTS idx_changes_scope_hlc ON {table} (scope, hlc_key)"),
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
        for (index, query) in migration_queries(table).iter().enumerate() {
            let mut q = sqlx::query(query);
            if index == 2 {
                q = q.bind(DEFAULT_SCOPE);
            }
            q.execute(pool).await?;
        }
        Ok(())
    }
}

// ── ChangeStore impl ──────────────────────────────────────────────────────

impl ChangeStore for PostgresStore {
    type Error = Error;

    async fn insert(&self, scope: &Scope, change: &Change) -> std::result::Result<(), Error> {
        let id = change.id;
        let hlc_key = change.hlc.sort_key();
        let hlc_millis = i64::try_from(change.hlc.millis()).map_err(|_| {
            Error::InvalidData(format!("hlc_millis {} overflows i64", change.hlc.millis()))
        })?;
        let hlc_counter = i64::from(change.hlc.counter());
        let hlc_node_id = change.hlc.node_id().to_string();
        let ops_json = serde_json::to_value(&change.ops)?;

        let query = format!(
            "INSERT INTO {} (id, scope, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
            self.table
        );
        sqlx::query(&query)
            .bind(id)
            .bind(scope.as_str())
            .bind(hlc_key)
            .bind(hlc_millis)
            .bind(hlc_counter)
            .bind(hlc_node_id)
            .bind(ops_json)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    async fn list_after(
        &self,
        scope: &Scope,
        after: Option<Hlc>,
        limit: Option<u32>,
    ) -> std::result::Result<Vec<Change>, Error> {
        let mut qb = sqlx::QueryBuilder::new(format!(
            "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM {} WHERE scope = ",
            self.table
        ));
        qb.push_bind(scope.as_str().to_owned());
        if let Some(hlc) = after {
            qb.push(" AND hlc_key > ").push_bind(hlc.sort_key());
        }
        qb.push(" ORDER BY hlc_key");
        if let Some(n) = limit {
            qb.push(" LIMIT ").push_bind(i64::from(n));
        }
        let rows: Vec<ChangeRow> = qb.build_query_as().fetch_all(&self.pool).await?;
        rows.into_iter().map(ChangeRow::try_into_change).collect()
    }
    async fn get(&self, scope: &Scope, id: Uuid) -> std::result::Result<Option<Change>, Error> {
        let query = format!(
            "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM {} WHERE id = $1 AND scope = $2",
            self.table
        );
        let row: Option<ChangeRow> = sqlx::query_as(&query)
            .bind(id)
            .bind(scope.as_str())
            .fetch_optional(&self.pool)
            .await?;
        row.map(ChangeRow::try_into_change).transpose()
    }
}

// ── Row mapping ───────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct ChangeRow {
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
    #[test]
    fn migration_qualifies_schema_and_backfills_legacy_scope() {
        let table = super::change_table("tenant_a").unwrap();
        let queries = super::migration_queries(&table);
        assert!(queries[0].contains("\"tenant_a\".\"palladium_changes\""));
        assert!(queries[1].contains("ADD COLUMN IF NOT EXISTS scope"));
        assert!(queries[2].contains("WHERE scope IS NULL"));
        assert_eq!(super::quote_identifier("bad-name").is_err(), true);
    }

    // ── Integration tests (require DATABASE_URL) ─────────────────────────

    #[cfg(feature = "integration-tests")]
    mod integration {
        use palladium_core::{Change, ChangeStore, Hlc, NodeId, Op, Scope};
        use serde_json::json;
        use sqlx::PgPool;
        use uuid::Uuid;

        use crate::PostgresStore;

        fn node(n: u128) -> NodeId {
            NodeId::from_uuid(Uuid::from_u128(n))
        }

        fn hlc(millis: u64, counter: u32, n: u128) -> Hlc {
            Hlc::from_parts(millis, counter, node(n))
        }

        #[sqlx::test]
        #[allow(clippy::unwrap_used)]
        async fn insert_and_get(pool: PgPool) {
            let store = PostgresStore::from_pool(pool);
            PostgresStore::migrate(&store.pool).await.unwrap();

            let change = Change::new(
                hlc(1_000, 0, 1),
                vec![Op::Insert {
                    table: "test".into(),
                    row_id: Uuid::new_v4(),
                    data: json!({}),
                }],
            );

            let scope = Scope::new("test-scope");
            store.insert(&scope, &change).await.unwrap();
            let got = store.get(&scope, change.id).await.unwrap();
            assert_eq!(got.unwrap().id, change.id);
        }
    }
}
