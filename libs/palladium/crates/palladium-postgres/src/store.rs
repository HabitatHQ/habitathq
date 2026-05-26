//! [`PostgresStore`] — `PostgreSQL`-backed [`ChangeStore`] implementation.

use palladium_core::{Change, ChangeStore, Hlc, InstanceConfig, Op, PostgresIsolation};
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

const MIGRATE: &str = "
CREATE TABLE IF NOT EXISTS palladium_changes (
    id          UUID    NOT NULL PRIMARY KEY,
    hlc_key     TEXT    NOT NULL,
    hlc_millis  BIGINT  NOT NULL,
    hlc_counter BIGINT  NOT NULL,
    hlc_node_id TEXT    NOT NULL,
    ops_json    JSONB   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_hlc ON palladium_changes (hlc_key);
";

// ── Query strings ──────────────────────────────────────────────────────────

const SELECT_COLS: &str =
    "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes";
const GET_BY_ID: &str =
    "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes WHERE id = $1";

// ── Store ─────────────────────────────────────────────────────────────────

/// `PostgreSQL`-backed persistent store for [`Change`]s.
///
/// Use [`PostgresStore::connect`] to create a store from a connection URL,
/// or [`PostgresStore::from_pool`] to reuse an existing [`PgPool`].
#[derive(Debug)]
pub struct PostgresStore {
    pool: PgPool,
    _open_guard: Option<palladium_core::OpenGuard>,
}

impl PostgresStore {
    /// Connect to `PostgreSQL` at `url` and migrate the schema.
    ///
    /// # Errors
    /// Returns an error if the connection or migration fails.
    pub async fn connect(url: &str) -> Result<Self> {
        let guard = palladium_core::register(url)?;
        let pool = PgPool::connect(url).await?;
        Self::migrate(&pool).await?;
        Ok(Self {
            pool,
            _open_guard: Some(guard),
        })
    }

    /// Connect to `PostgreSQL` using the given [`InstanceConfig`].
    ///
    /// Applies schema or database isolation depending on
    /// [`InstanceConfig::postgres`] settings.
    ///
    /// # Errors
    /// Returns an error if the connection, schema creation, or migration fails.
    pub async fn connect_with_config(cfg: &InstanceConfig) -> Result<Self> {
        let guard = palladium_core::register(&cfg.path)?;

        let postgres_opts = cfg.postgres.as_ref();
        let isolation = postgres_opts
            .map_or(&PostgresIsolation::Schema, |p| &p.isolation);

        match isolation {
            PostgresIsolation::Schema => {
                let schema = postgres_opts
                    .and_then(|p| p.schema.as_deref())
                    .unwrap_or(&cfg.name);
                validate_identifier(schema)?;
                let pool = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(cfg.limits.pool_size)
                    .acquire_timeout(std::time::Duration::from_secs(
                        cfg.limits.acquire_timeout_secs,
                    ))
                    .idle_timeout(std::time::Duration::from_secs(
                        cfg.limits.idle_timeout_secs,
                    ))
                    .connect(&cfg.path)
                    .await?;
                // Create schema and set search_path.
                sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS {schema}"))
                    .execute(&pool)
                    .await?;
                sqlx::query(&format!("SET search_path TO {schema}"))
                    .execute(&pool)
                    .await?;
                Self::migrate(&pool).await?;
                Ok(Self {
                    pool,
                    _open_guard: Some(guard),
                })
            }
            PostgresIsolation::Db => {
                let pool = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(cfg.limits.pool_size)
                    .acquire_timeout(std::time::Duration::from_secs(
                        cfg.limits.acquire_timeout_secs,
                    ))
                    .idle_timeout(std::time::Duration::from_secs(
                        cfg.limits.idle_timeout_secs,
                    ))
                    .connect(&cfg.path)
                    .await?;
                Self::migrate(&pool).await?;
                Ok(Self {
                    pool,
                    _open_guard: Some(guard),
                })
            }
        }
    }

    /// Wrap an existing connection pool (schema must already be migrated).
    #[must_use]
    pub const fn from_pool(pool: PgPool) -> Self {
        Self {
            pool,
            _open_guard: None,
        }
    }

    /// Run schema migrations against `pool`.
    ///
    /// # Errors
    /// Returns an error if the migration query fails.
    pub async fn migrate(pool: &PgPool) -> Result<()> {
        sqlx::query(MIGRATE).execute(pool).await?;
        Ok(())
    }
}

// ── ChangeStore impl ──────────────────────────────────────────────────────

impl ChangeStore for PostgresStore {
    type Error = Error;

    async fn insert(&self, change: &Change) -> std::result::Result<(), Error> {
        let id = change.id;
        let hlc_key = change.hlc.sort_key();
        let hlc_millis = i64::try_from(change.hlc.millis()).map_err(|_| {
            Error::InvalidData(format!(
                "hlc_millis {} overflows i64",
                change.hlc.millis()
            ))
        })?;
        let hlc_counter = i64::from(change.hlc.counter());
        let hlc_node_id = change.hlc.node_id().to_string();
        let ops_json = serde_json::to_value(&change.ops)?;

        sqlx::query(
            "INSERT INTO palladium_changes \
             (id, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
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
        after: Option<Hlc>,
        limit: Option<u32>,
    ) -> std::result::Result<Vec<Change>, Error> {
        let mut qb = sqlx::QueryBuilder::new(SELECT_COLS);
        if let Some(hlc) = after {
            qb.push(" WHERE hlc_key > ").push_bind(hlc.sort_key());
        }
        qb.push(" ORDER BY hlc_key");
        if let Some(n) = limit {
            qb.push(" LIMIT ").push_bind(i64::from(n));
        }
        let rows: Vec<ChangeRow> = qb.build_query_as().fetch_all(&self.pool).await?;
        rows.into_iter().map(ChangeRow::try_into_change).collect()
    }

    async fn get(&self, id: Uuid) -> std::result::Result<Option<Change>, Error> {
        let row: Option<ChangeRow> = sqlx::query_as(GET_BY_ID)
            .bind(id)
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
        Ok(Change { id: self.id, hlc, ops })
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

    // ── Integration tests (require DATABASE_URL) ─────────────────────────

    #[cfg(feature = "integration-tests")]
    mod integration {
        use palladium_core::{Change, ChangeStore, Hlc, NodeId, Op};
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

            let change = Change::new(hlc(1_000, 0, 1), vec![Op::Insert {
                table: "test".into(),
                row_id: Uuid::new_v4(),
                data: json!({}),
            }]);

            store.insert(&change).await.unwrap();
            let got = store.get(change.id).await.unwrap();
            assert_eq!(got.unwrap().id, change.id);
        }
    }
}
