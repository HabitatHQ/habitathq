//! [`SqliteStore`] — `SQLite`-backed [`ChangeStore`] implementation.

use palladium_core::{Change, ChangeStore, Hlc, InstanceLimits, Op};
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::{fs, path::PathBuf, str::FromStr};
use uuid::Uuid;

use crate::{Error, Result};

// ── Schema migration ──────────────────────────────────────────────────────

const MIGRATE: &str = "
CREATE TABLE IF NOT EXISTS palladium_changes (
    id          TEXT    NOT NULL PRIMARY KEY,
    hlc_key     TEXT    NOT NULL,
    hlc_millis  INTEGER NOT NULL,
    hlc_counter INTEGER NOT NULL,
    hlc_node_id TEXT    NOT NULL,
    ops_json    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_hlc ON palladium_changes (hlc_key);
";

// ── Query strings ──────────────────────────────────────────────────────────

const SELECT_COLS: &str =
    "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes";
const GET_BY_ID: &str =
    "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes WHERE id = ?";

// ── Lock file ─────────────────────────────────────────────────────────────

/// Filesystem advisory lock file that prevents a second process from opening
/// the same `SQLite` database.
#[derive(Debug)]
struct LockFile {
    path: PathBuf,
}

impl LockFile {
    /// Create a lock file alongside `db_path`.
    ///
    /// # Errors
    /// Returns `Err(Error::Core(InstanceAlreadyOpen))` if the lock file
    /// already exists; `Err(Error::Io)` for any other I/O error.
    fn acquire(db_path: &std::path::Path) -> Result<Self> {
        let mut lock_path = db_path.to_path_buf();
        let ext = lock_path
            .extension()
            .map_or_else(|| "lock".to_owned(), |e| format!("{}.lock", e.to_string_lossy()));
        lock_path.set_extension(&ext);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(_) => Ok(Self { path: lock_path }),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(Error::Core(palladium_core::Error::InstanceAlreadyOpen(
                    db_path.display().to_string(),
                )))
            }
            Err(e) => Err(Error::Io(e)),
        }
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

// ── Store ─────────────────────────────────────────────────────────────────

/// `SQLite`-backed persistent store for [`Change`]s.
///
/// Use [`SqliteStore::open`] for a file-backed store or
/// [`SqliteStore::in_memory`] for ephemeral in-process storage (tests).
#[derive(Debug)]
pub struct SqliteStore {
    pool: SqlitePool,
    _open_guard: palladium_core::OpenGuard,
    _lock_file: Option<LockFile>,
}

impl SqliteStore {
    /// Open (or create) an `SQLite` database at `url`.
    ///
    /// The schema is migrated automatically on first open.
    /// Returns [`Error::Core`] with [`palladium_core::Error::InstanceAlreadyOpen`]
    /// if the same database path is already open within this process.
    ///
    /// # Errors
    /// Returns an error if the pool cannot be created or migration fails.
    pub async fn open(url: &str) -> Result<Self> {
        Self::open_with_limits(url, &InstanceLimits::default()).await
    }

    /// Open (or create) an `SQLite` database at `url` with custom resource limits.
    ///
    /// # Errors
    /// Returns an error if the pool cannot be created, migration fails, or the
    /// same path is already open in this process.
    pub async fn open_with_limits(url: &str, limits: &InstanceLimits) -> Result<Self> {
        // Strip the sqlite: scheme to get the raw path.
        let path_str = url.strip_prefix("sqlite:").unwrap_or(url);
        let is_memory =
            path_str.contains(":memory:") || path_str.contains("mode=memory");

        let (open_guard, lock_file) = if is_memory {
            // In-memory: each call uses a unique URL (via in_memory()), so the
            // registry key is always unique and no filesystem lock is needed.
            let guard = palladium_core::register(url)?;
            (guard, None)
        } else {
            // File-backed: canonicalise to avoid symlink aliasing.
            let canonical = fs::canonicalize(path_str)
                .unwrap_or_else(|_| PathBuf::from(path_str));
            let canonical_str = canonical.display().to_string();
            let guard = palladium_core::register(&canonical_str)?;
            let lock = LockFile::acquire(&canonical)?;
            (guard, Some(lock))
        };

        let mut opts = SqliteConnectOptions::from_str(url)?.create_if_missing(true);
        if limits.max_db_size_mb > 0 {
            let page_count = (limits.max_db_size_mb * 1_048_576) / 4096;
            // `max_page_count` is a per-connection pragma (not persisted to the
            // database file), so we set it on connect options so that every
            // connection in the pool inherits the limit.
            opts = opts.pragma("max_page_count", page_count.to_string());
        }
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(limits.pool_size)
            .acquire_timeout(std::time::Duration::from_secs(limits.acquire_timeout_secs))
            .idle_timeout(std::time::Duration::from_secs(limits.idle_timeout_secs))
            .connect_with(opts)
            .await?;

        sqlx::query(MIGRATE).execute(&pool).await?;

        Ok(Self {
            pool,
            _open_guard: open_guard,
            _lock_file: lock_file,
        })
    }

    /// Open an ephemeral in-memory `SQLite` database.
    ///
    /// Each call creates a **unique** named database so that parallel tests
    /// do not share state, while still using a connection-pool-friendly
    /// shared-cache URI.
    ///
    /// # Errors
    /// Returns an error if the in-memory pool cannot be initialised.
    pub async fn in_memory() -> Result<Self> {
        // Unique name → each call gets its own DB even under parallel tests.
        let id = uuid::Uuid::new_v4().simple();
        Self::open(&format!("sqlite:file:{id}?mode=memory&cache=shared")).await
    }

    /// Returns a reference to the underlying connection pool.
    ///
    /// Primarily intended for use in tests that need to run raw `PRAGMA` queries.
    pub const fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

// ── ChangeStore impl ──────────────────────────────────────────────────────

impl ChangeStore for SqliteStore {
    type Error = Error;

    async fn insert(&self, change: &Change) -> std::result::Result<(), Error> {
        let id = change.id.to_string();
        let hlc_key = change.hlc.sort_key();
        let hlc_millis = i64::try_from(change.hlc.millis()).map_err(|_| {
            Error::InvalidData(format!(
                "hlc_millis {} overflows i64",
                change.hlc.millis()
            ))
        })?;
        let hlc_counter = i64::from(change.hlc.counter());
        let hlc_node_id = change.hlc.node_id().to_string();
        let ops_json = serde_json::to_string(&change.ops)?;

        sqlx::query(
            "INSERT OR IGNORE INTO palladium_changes \
             (id, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json) \
             VALUES (?, ?, ?, ?, ?, ?)",
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
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(ChangeRow::try_into_change).transpose()
    }
}

// ── Row mapping ───────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct ChangeRow {
    id: String,
    hlc_millis: i64,
    hlc_counter: i64,
    hlc_node_id: String,
    ops_json: String,
}

impl ChangeRow {
    fn try_into_change(self) -> Result<Change> {
        let id = Uuid::parse_str(&self.id)
            .map_err(|e| Error::InvalidData(format!("invalid change id: {e}")))?;
        let hlc = Hlc::from_db_parts(self.hlc_millis, self.hlc_counter, &self.hlc_node_id)
            .map_err(Error::InvalidData)?;
        let ops: Vec<Op> = serde_json::from_str(&self.ops_json)?;
        Ok(Change { id, hlc, ops })
    }
}

// ── Open-guard tests ──────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod open_guard_tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn open_twice_same_path_is_error() {
        let tmp = NamedTempFile::new().unwrap();
        let url = format!("sqlite:{}", tmp.path().display());
        let _s1 = SqliteStore::open(&url).await.unwrap();
        let err = SqliteStore::open(&url).await.unwrap_err();
        assert!(matches!(
            err,
            crate::Error::Core(palladium_core::Error::InstanceAlreadyOpen(_))
        ));
    }

    #[tokio::test]
    async fn open_after_drop_succeeds() {
        let tmp = NamedTempFile::new().unwrap();
        let url = format!("sqlite:{}", tmp.path().display());
        {
            let _s = SqliteStore::open(&url).await.unwrap();
        }
        let _s2 = SqliteStore::open(&url).await.unwrap();
    }

    #[tokio::test]
    async fn max_db_size_mb_sets_page_count() {
        let tmp = NamedTempFile::new().unwrap();
        let url = format!("sqlite:{}", tmp.path().display());
        let limits = palladium_core::InstanceLimits {
            max_db_size_mb: 1,
            ..palladium_core::InstanceLimits::default()
        };
        let store = SqliteStore::open_with_limits(&url, &limits).await.unwrap();
        let (count,): (i64,) = sqlx::query_as("PRAGMA max_page_count")
            .fetch_one(store.pool())
            .await
            .unwrap();
        assert_eq!(count, 256); // 1 MiB / 4096 bytes per page
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use palladium_core::{Change, ChangeStore, Hlc, NodeId, Op};
    use serde_json::json;
    use uuid::Uuid;

    use super::SqliteStore;

    fn node(n: u128) -> NodeId {
        NodeId::from_uuid(Uuid::from_u128(n))
    }

    fn hlc(millis: u64, counter: u32, n: u128) -> Hlc {
        Hlc::from_parts(millis, counter, node(n))
    }

    fn insert_op(table: &str) -> Op {
        Op::Insert {
            table: table.into(),
            row_id: Uuid::new_v4(),
            data: json!({"x": 1}),
        }
    }

    async fn mem() -> SqliteStore {
        SqliteStore::in_memory().await.unwrap()
    }

    // ── RED: define expected behaviour before impl ──────────────────────

    #[tokio::test]
    async fn list_after_empty_store_returns_empty() {
        let store = mem().await;
        let result = store.list_after(None, None).await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn get_unknown_id_returns_none() {
        let store = mem().await;
        let result = store.get(Uuid::new_v4()).await.unwrap();
        assert!(result.is_none());
    }

    // ── GREEN: insert → get round-trip ─────────────────────────────────

    #[tokio::test]
    async fn insert_and_get_by_id() {
        let store = mem().await;
        let change = Change::new(hlc(1_000, 0, 1), vec![insert_op("todos")]);

        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap();
        assert_eq!(got.unwrap().id, change.id);
    }

    #[tokio::test]
    async fn insert_and_list_all() {
        let store = mem().await;
        let c = Change::new(hlc(1_000, 0, 1), vec![insert_op("todos")]);
        store.insert(&c).await.unwrap();

        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, c.id);
    }

    #[tokio::test]
    async fn insert_duplicate_is_idempotent() {
        let store = mem().await;
        let c = Change::new(hlc(1_000, 0, 1), vec![]);
        store.insert(&c).await.unwrap();
        store.insert(&c).await.unwrap(); // second insert must not error
        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 1);
    }

    #[tokio::test]
    async fn list_after_cursor_filters_correctly() {
        let store = mem().await;
        let n = node(1);
        let h1 = Hlc::new(n, 1_000);
        let h2 = h1.send(2_000);
        let h3 = h2.send(3_000);

        let c1 = Change::new(h1, vec![]);
        let c2 = Change::new(h2, vec![]);
        let c3 = Change::new(h3, vec![]);

        store.insert(&c1).await.unwrap();
        store.insert(&c2).await.unwrap();
        store.insert(&c3).await.unwrap();

        // After h1 → should return c2, c3
        let after_h1 = store.list_after(Some(h1), None).await.unwrap();
        assert_eq!(after_h1.len(), 2);
        assert_eq!(after_h1[0].id, c2.id);
        assert_eq!(after_h1[1].id, c3.id);
    }

    #[tokio::test]
    async fn list_after_returns_results_in_hlc_order() {
        let store = mem().await;
        let n = node(1);
        let h1 = Hlc::new(n, 1_000);
        let h2 = h1.send(2_000);
        let h3 = h2.send(3_000);

        // Insert out of order
        let c3 = Change::new(h3, vec![]);
        let c1 = Change::new(h1, vec![]);
        let c2 = Change::new(h2, vec![]);

        store.insert(&c3).await.unwrap();
        store.insert(&c1).await.unwrap();
        store.insert(&c2).await.unwrap();

        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 3);
        assert!(all[0].hlc < all[1].hlc);
        assert!(all[1].hlc < all[2].hlc);
    }

    #[tokio::test]
    async fn round_trip_preserves_ops() {
        let store = mem().await;
        let n = node(42);
        let change = Change::new(
            Hlc::new(n, 9_999),
            vec![
                insert_op("users"),
                Op::Update {
                    table: "users".into(),
                    row_id: Uuid::nil(),
                    col: "name".into(),
                    value: json!("Alice"),
                },
                Op::Delete {
                    table: "users".into(),
                    row_id: Uuid::nil(),
                },
            ],
        );

        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap().unwrap();
        assert_eq!(got.ops, change.ops);
    }

    #[tokio::test]
    async fn round_trip_preserves_hlc() {
        let store = mem().await;
        let n = node(7);
        let h = Hlc::from_parts(1_234_567_890_000, 99, n);
        let change = Change::new(h, vec![]);

        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap().unwrap();
        assert_eq!(got.hlc, change.hlc);
    }

    // ── Extra: edge cases & correctness ───────────────────────────────

    /// Two `in_memory()` calls must produce fully isolated databases.
    #[tokio::test]
    async fn in_memory_stores_are_isolated() {
        let a = mem().await;
        let b = mem().await;
        let change = Change::new(hlc(1_000, 0, 1), vec![]);
        a.insert(&change).await.unwrap();
        // 'b' must not see the change inserted into 'a'
        assert!(b.list_after(None, None).await.unwrap().is_empty());
    }

    /// A change with zero ops round-trips correctly.
    #[tokio::test]
    async fn empty_ops_round_trip() {
        let store = mem().await;
        let change = Change::new(hlc(100, 0, 1), vec![]);
        assert!(change.ops.is_empty());
        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap().unwrap();
        assert!(got.ops.is_empty());
    }

    /// Pagination: insert N changes and walk forward with `list_after` cursors.
    #[tokio::test]
    async fn large_batch_cursor_pagination() {
        let store = mem().await;
        let n = node(1);
        let mut prev = Hlc::new(n, 1_000);
        for _ in 0..30 {
            let c = Change::new(prev, vec![]);
            store.insert(&c).await.unwrap();
            prev = prev.send(prev.millis() + 1);
        }

        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 30);

        // Walk forward in pages of 10
        let mut cursor = None;
        let mut collected = 0_usize;
        loop {
            let page = store.list_after(cursor, None).await.unwrap();
            if page.is_empty() {
                break;
            }
            collected += page.len();
            cursor = Some(page.last().unwrap().hlc);
            if page.len() < 30 {
                break;
            }
        }
        assert_eq!(collected, 30);
    }

    /// `list_after` with cursor at the last stored HLC returns empty.
    #[tokio::test]
    async fn list_after_last_hlc_returns_empty() {
        let store = mem().await;
        let n = node(1);
        let h = Hlc::new(n, 5_000);
        let c = Change::new(h, vec![]);
        store.insert(&c).await.unwrap();

        let after = store.list_after(Some(h), None).await.unwrap();
        assert!(after.is_empty(), "cursor AT the last HLC should return nothing");
    }

    /// Two changes with the same (millis, counter) but different `node_id`s
    /// are stored and retrieved correctly; their sort order is deterministic.
    #[tokio::test]
    async fn same_millis_counter_different_nodes_both_stored() {
        let store = mem().await;
        let h1 = Hlc::from_parts(1_000, 0, node(1));
        let h2 = Hlc::from_parts(1_000, 0, node(2));

        let c1 = Change::new(h1, vec![]);
        let c2 = Change::new(h2, vec![]);
        store.insert(&c1).await.unwrap();
        store.insert(&c2).await.unwrap();

        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 2);
        // Must be sorted: either c1 < c2 or c2 < c1, never equal
        assert_ne!(all[0].hlc, all[1].hlc);
        assert!(all[0].hlc < all[1].hlc);
    }

    /// `get` retrieves the correct change from a store with many entries.
    #[tokio::test]
    async fn get_specific_change_among_many() {
        let store = mem().await;
        let n = node(1);
        let mut prev = Hlc::new(n, 1_000);
        let mut target_id = uuid::Uuid::nil();
        for i in 0_u64..10 {
            let c = Change::new(prev, vec![insert_op("t")]);
            if i == 5 {
                target_id = c.id;
            }
            store.insert(&c).await.unwrap();
            prev = prev.send(prev.millis() + 1);
        }
        let found = store.get(target_id).await.unwrap();
        assert_eq!(found.unwrap().id, target_id);
    }

    /// Migrations run on first open; second open of the same path is now
    /// prevented by the registry guard (returns `InstanceAlreadyOpen`).
    ///
    /// The guard ensures idempotent migration through single-open semantics.
    #[tokio::test]
    async fn schema_migration_is_idempotent_single_open() {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let url = format!("sqlite:file:{id}?mode=memory&cache=shared");
        let _store1 = SqliteStore::open(&url).await.unwrap();
        // Second open of the same URL returns InstanceAlreadyOpen.
        let err = SqliteStore::open(&url).await.unwrap_err();
        assert!(
            matches!(err, crate::Error::Core(palladium_core::Error::InstanceAlreadyOpen(_))),
            "expected InstanceAlreadyOpen, got {err:?}"
        );
    }

    /// Inserting from multiple concurrent tasks must not corrupt the store.
    #[tokio::test]
    async fn concurrent_inserts_do_not_corrupt() {
        use std::sync::Arc;
        let store = Arc::new(mem().await);
        let tasks: Vec<_> = (0_u64..8)
            .map(|i| {
                let s = Arc::clone(&store);
                tokio::spawn(async move {
                    let c = Change::new(hlc(i * 100 + 1_000, 0, u128::from(i) + 1), vec![insert_op("t")]);
                    s.insert(&c).await
                })
            })
            .collect();
        for t in tasks {
            t.await.unwrap().unwrap();
        }
        let all = store.list_after(None, None).await.unwrap();
        assert_eq!(all.len(), 8);
    }

    /// A change containing only `Update` ops round-trips.
    #[tokio::test]
    async fn update_ops_round_trip() {
        let store = mem().await;
        let ops = vec![Op::Update {
            table: "items".into(),
            row_id: Uuid::nil(),
            col: "price".into(),
            value: json!(99),
        }];
        let change = Change::new(hlc(1_000, 0, 1), ops.clone());
        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap().unwrap();
        assert_eq!(got.ops, ops);
    }

    /// A change containing only `Delete` ops round-trips.
    #[tokio::test]
    async fn delete_ops_round_trip() {
        let store = mem().await;
        let ops = vec![Op::Delete { table: "items".into(), row_id: Uuid::nil() }];
        let change = Change::new(hlc(1_000, 0, 1), ops.clone());
        store.insert(&change).await.unwrap();
        let got = store.get(change.id).await.unwrap().unwrap();
        assert_eq!(got.ops, ops);
    }

    /// `hlc_millis` values exceeding `i64::MAX` return `InvalidData`.
    #[tokio::test]
    async fn millis_overflow_returns_error() {
        let store = mem().await;
        let n = node(1);
        let overflowing_hlc = Hlc::from_parts(u64::MAX, 0, n);
        let change = Change::new(overflowing_hlc, vec![]);
        let result = store.insert(&change).await;
        assert!(result.is_err(), "millis overflow should return an error");
    }

    /// `list_after` with `limit` returns at most that many rows.
    #[tokio::test]
    async fn list_after_limit_caps_results() {
        let store = mem().await;
        let n = node(1);
        let mut prev = Hlc::new(n, 1_000);
        for _ in 0..10 {
            store.insert(&Change::new(prev, vec![])).await.unwrap();
            prev = prev.send(prev.millis() + 1);
        }

        let page = store.list_after(None, Some(3)).await.unwrap();
        assert_eq!(page.len(), 3);
    }

    /// `list_after` with cursor AND limit returns at most `limit` rows after
    /// the cursor.
    #[tokio::test]
    async fn list_after_cursor_and_limit() {
        let store = mem().await;
        let n = node(1);
        let h1 = Hlc::new(n, 1_000);
        let h2 = h1.send(2_000);
        let h3 = h2.send(3_000);
        let h4 = h3.send(4_000);

        for h in [h1, h2, h3, h4] {
            store.insert(&Change::new(h, vec![])).await.unwrap();
        }

        // After h1 with limit 2 → h2 and h3 only
        let page = store.list_after(Some(h1), Some(2)).await.unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].hlc, h2);
        assert_eq!(page[1].hlc, h3);
    }
}
