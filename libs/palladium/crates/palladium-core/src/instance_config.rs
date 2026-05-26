//! Per-instance configuration types used by storage backends and the CLI.

/// Selects the storage backend for an instance.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackendKind {
    /// `SQLite` file database (default).
    #[default]
    Sqlite,
    /// `PostgreSQL` database.
    Postgres,
}

/// Resource and connection limits for one instance.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InstanceLimits {
    /// Maximum sqlx pool connections. Default: 5.
    #[serde(default = "InstanceLimits::default_pool_size")]
    pub pool_size: u32,

    /// `SQLite` only: max DB file size in MiB. 0 = unlimited. Default: 0.
    #[serde(default)]
    pub max_db_size_mb: u64,

    /// sqlx acquire timeout in seconds. Default: 30.
    #[serde(default = "InstanceLimits::default_acquire_timeout_secs")]
    pub acquire_timeout_secs: u64,

    /// sqlx idle timeout in seconds. Default: 600.
    #[serde(default = "InstanceLimits::default_idle_timeout_secs")]
    pub idle_timeout_secs: u64,
}

impl InstanceLimits {
    const fn default_pool_size() -> u32 {
        5
    }

    const fn default_acquire_timeout_secs() -> u64 {
        30
    }

    const fn default_idle_timeout_secs() -> u64 {
        600
    }
}

impl Default for InstanceLimits {
    fn default() -> Self {
        Self {
            pool_size: Self::default_pool_size(),
            max_db_size_mb: 0,
            acquire_timeout_secs: Self::default_acquire_timeout_secs(),
            idle_timeout_secs: Self::default_idle_timeout_secs(),
        }
    }
}

/// Postgres isolation strategy for multi-instance setups.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PostgresIsolation {
    /// One Postgres database per instance.
    Db,
    /// One schema per instance within a shared database (default).
    #[default]
    Schema,
}

/// Postgres-specific instance options.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PostgresInstanceOptions {
    /// Isolation mode. Default: `schema`.
    #[serde(default)]
    pub isolation: PostgresIsolation,

    /// Schema name when `isolation = "schema"`. Defaults to the instance name.
    pub schema: Option<String>,
}

/// Configuration for a single engine instance.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InstanceConfig {
    /// Human-readable name; used in CLI output and health route paths.
    pub name: String,

    /// Filesystem path (`SQLite`) or connection string (Postgres).
    pub path: String,

    /// Storage backend. Default: `sqlite`.
    #[serde(default)]
    pub backend: BackendKind,

    /// Resource limits.
    #[serde(default)]
    pub limits: InstanceLimits,

    /// Postgres-specific options. Ignored for `SQLite` backends.
    #[serde(default)]
    pub postgres: Option<PostgresInstanceOptions>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_limits_defaults() {
        let lim = InstanceLimits::default();
        assert_eq!(lim.pool_size, 5);
        assert_eq!(lim.max_db_size_mb, 0);
        assert_eq!(lim.acquire_timeout_secs, 30);
        assert_eq!(lim.idle_timeout_secs, 600);
    }

    #[test]
    fn backend_kind_default_is_sqlite() {
        let k = BackendKind::default();
        assert_eq!(k, BackendKind::Sqlite);
    }

    #[test]
    fn postgres_isolation_default_is_schema() {
        let iso = PostgresIsolation::default();
        assert_eq!(iso, PostgresIsolation::Schema);
    }
}
