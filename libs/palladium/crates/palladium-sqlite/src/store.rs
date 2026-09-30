//! [`SqliteStore`] — `SQLite`-backed [`ChangeStore`] implementation.

use fs2::FileExt;
use palladium_core::{Change, ChangeStore, Hlc, InstanceLimits, Op, Scope};
use sha2::Digest;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
#[cfg(feature = "crash-test-fixtures")]
use std::io::Write;
use std::{fs, path::PathBuf, str::FromStr};
use uuid::Uuid;

use crate::{Error, Result};
const MIGRATE_CREATE: &str = "
CREATE TABLE IF NOT EXISTS palladium_changes (
    append_seq INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    scope TEXT NOT NULL,
    hlc_millis INTEGER NOT NULL,
    hlc_counter INTEGER NOT NULL,
    hlc_node_id TEXT NOT NULL,
    ops_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    UNIQUE(scope, id)
)";
#[cfg(feature = "crash-test-fixtures")]
fn crash_at_append_boundary(boundary: &str, change_id: Uuid) -> Result<()> {
    let Ok(configured) = std::env::var("PALLADIUM_SQLITE_CRASH_APPEND") else {
        return Ok(());
    };
    if configured != boundary {
        return Ok(());
    }
    let Ok(target) = std::env::var("PALLADIUM_SQLITE_CRASH_CHANGE_ID") else {
        return Ok(());
    };
    if target != change_id.to_string() {
        return Ok(());
    }
    let Ok(marker) = std::env::var("PALLADIUM_SQLITE_CRASH_MARKER") else {
        return Ok(());
    };
    let mut marker = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(Error::Io(error)),
    };
    writeln!(marker, "{boundary}:{change_id}").map_err(Error::Io)?;
    marker.sync_all().map_err(Error::Io)?;
    std::process::abort();
}

#[derive(sqlx::FromRow)]
struct LegacyChangeRow {
    id: String,
    scope: String,
    hlc_millis: i64,
    hlc_counter: i64,
    hlc_node_id: String,
    ops_json: String,
}

fn payload_hash(row: &LegacyChangeRow) -> Result<String> {
    let id = Uuid::parse_str(&row.id)
        .map_err(|error| Error::InvalidData(format!("invalid change id: {error}")))?;
    let hlc = Hlc::from_db_parts(row.hlc_millis, row.hlc_counter, &row.hlc_node_id)
        .map_err(Error::InvalidData)?;
    let ops: Vec<Op> = serde_json::from_str(&row.ops_json)?;
    let payload = palladium_core::canonical_change_bytes(&Change { id, hlc, ops })?;
    Ok(format!("{:x}", sha2::Sha256::digest(payload)))
}

async fn backfill_payload_hashes(pool: &SqlitePool) -> Result<()> {
    let rows: Vec<LegacyChangeRow> = sqlx::query_as(
        "SELECT id, scope, hlc_millis, hlc_counter, hlc_node_id, ops_json
           FROM palladium_changes
          WHERE payload_hash IS NULL OR payload_hash = ''",
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        let hash = payload_hash(&row)?;
        sqlx::query("UPDATE palladium_changes SET payload_hash = ? WHERE scope = ? AND id = ?")
            .bind(hash)
            .bind(row.scope)
            .bind(row.id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

async fn rebuild_legacy_table(pool: &SqlitePool, has_scope: bool) -> Result<()> {
    let scope = if has_scope {
        "COALESCE(scope, 'default')"
    } else {
        "'default'"
    };
    let mut tx = pool.begin().await?;
    sqlx::query("ALTER TABLE palladium_changes RENAME TO palladium_changes_legacy_v1")
        .execute(&mut *tx)
        .await?;
    sqlx::query(MIGRATE_CREATE).execute(&mut *tx).await?;
    let rows: Vec<LegacyChangeRow> = sqlx::query_as(&format!(
        "SELECT id, {scope} AS scope, hlc_millis, hlc_counter, hlc_node_id, ops_json
           FROM palladium_changes_legacy_v1
          ORDER BY rowid"
    ))
    .fetch_all(&mut *tx)
    .await?;
    for row in rows {
        let hash = payload_hash(&row)?;
        sqlx::query(
            "INSERT INTO palladium_changes
             (id, scope, hlc_millis, hlc_counter, hlc_node_id, ops_json, payload_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(row.id)
        .bind(row.scope)
        .bind(row.hlc_millis)
        .bind(row.hlc_counter)
        .bind(row.hlc_node_id)
        .bind(row.ops_json)
        .bind(hash)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DROP TABLE palladium_changes_legacy_v1")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

async fn migrate(pool: &SqlitePool) -> Result<()> {
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'palladium_changes'",
    )
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        sqlx::query(MIGRATE_CREATE).execute(pool).await?;
    } else {
        let columns: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM pragma_table_info('palladium_changes')")
                .fetch_all(pool)
                .await?;
        let has_column = |name: &str| columns.iter().any(|(column,)| column == name);
        let has_scope = has_column("scope");
        if has_column("append_seq") {
            if !has_scope {
                sqlx::query("ALTER TABLE palladium_changes ADD COLUMN scope TEXT")
                    .execute(pool)
                    .await?;
            }
            sqlx::query("UPDATE palladium_changes SET scope = 'default' WHERE scope IS NULL")
                .execute(pool)
                .await?;
            if !has_column("payload_hash") {
                sqlx::query("ALTER TABLE palladium_changes ADD COLUMN payload_hash TEXT")
                    .execute(pool)
                    .await?;
            }
            backfill_payload_hashes(pool).await?;
        } else {
            rebuild_legacy_table(pool, has_scope).await?;
        }
    }
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_changes_scope_append ON palladium_changes(scope, append_seq)")
        .execute(pool)
        .await?;
    Ok(())
}

const SELECT_COLS: &str =
    "SELECT append_seq, id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes";
const GET_BY_ID: &str =
    "SELECT append_seq, id, hlc_millis, hlc_counter, hlc_node_id, ops_json FROM palladium_changes WHERE id = ? AND scope = ?";

// ── Lock file ─────────────────────────────────────────────────────────────

/// Filesystem advisory lock that prevents a second live process from opening
/// the same `SQLite` database. The operating system releases it when a process
/// terminates, including after a crash.
#[derive(Debug)]
struct LockFile {
    _file: fs::File,
}

impl LockFile {
    /// Acquire an advisory lock alongside `db_path`.
    ///
    /// # Errors
    /// Returns `Err(Error::Core(InstanceAlreadyOpen))` when another live
    /// process owns the lock, or `Err(Error::Io)` for filesystem failures.
    fn acquire(db_path: &std::path::Path) -> Result<Self> {
        let mut lock_path = db_path.to_path_buf();
        let ext = lock_path.extension().map_or_else(
            || "lock".to_owned(),
            |extension| format!("{}.lock", extension.to_string_lossy()),
        );
        lock_path.set_extension(&ext);
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { _file: file }),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == fs2::lock_contended_error().kind() =>
            {
                Err(Error::Core(palladium_core::Error::InstanceAlreadyOpen(
                    db_path.display().to_string(),
                )))
            }
            Err(error) => Err(Error::Io(error)),
        }
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
        let is_memory = path_str.contains(":memory:") || path_str.contains("mode=memory");

        let (open_guard, lock_file) = if is_memory {
            // In-memory: each call uses a unique URL (via in_memory()), so the
            // registry key is always unique and no filesystem lock is needed.
            let guard = palladium_core::register(url)?;
            (guard, None)
        } else {
            // File-backed: canonicalise to avoid symlink aliasing.
            let canonical = fs::canonicalize(path_str).unwrap_or_else(|_| PathBuf::from(path_str));
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

        migrate(&pool).await?;

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
        let ops_json = serde_json::to_string(&change.ops)?;
        let mut tx = self.pool.begin().await?;
        let inserted: Option<(i64,)> = sqlx::query_as(
            "INSERT INTO palladium_changes
             (id, scope, hlc_millis, hlc_counter, hlc_node_id, ops_json, payload_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(scope, id) DO NOTHING
             RETURNING append_seq",
        )
        .bind(change.id.to_string())
        .bind(scope.as_str())
        .bind(millis)
        .bind(i64::from(change.hlc.counter()))
        .bind(change.hlc.node_id().to_string())
        .bind(ops_json)
        .bind(&hash)
        .fetch_optional(&mut *tx)
        .await?;
        let (seq, inserted) = if let Some((seq,)) = inserted {
            (seq, true)
        } else {
            let (seq, existing): (i64, String) = sqlx::query_as(
                "SELECT append_seq, payload_hash FROM palladium_changes WHERE scope = ? AND id = ?",
            )
            .bind(scope.as_str())
            .bind(change.id.to_string())
            .fetch_one(&mut *tx)
            .await?;
            if existing != hash {
                return Err(Error::InvalidData("change_conflict".into()));
            }
            (seq, false)
        };
        #[cfg(feature = "crash-test-fixtures")]
        if inserted {
            crash_at_append_boundary("before-commit", change.id)?;
        }
        tx.commit().await?;
        #[cfg(feature = "crash-test-fixtures")]
        if inserted {
            crash_at_append_boundary("after-commit", change.id)?;
        }
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
        let upper_db: (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(append_seq),0) FROM palladium_changes WHERE scope = ?",
        )
        .bind(scope.as_str())
        .fetch_one(&self.pool)
        .await?;
        let upper = u64::try_from(upper_db.0)
            .map_err(|_| Error::InvalidData("append sequence is negative".into()))?;
        let start = after.map_or(0, palladium_core::AppendCursor::position);
        let start_db = i64::try_from(start)
            .map_err(|_| Error::InvalidData("append cursor exceeds database range".into()))?;
        let rows: Vec<ChangeRow> = sqlx::query_as(&format!("{SELECT_COLS} WHERE scope = ? AND append_seq > ? AND append_seq <= ? ORDER BY append_seq LIMIT ?"))
            .bind(scope.as_str()).bind(start_db).bind(upper_db.0).bind(i64::from(limit)).fetch_all(&self.pool).await?;
        let cursor = rows
            .last()
            .map(|row| {
                u64::try_from(row.append_seq)
                    .map(palladium_core::AppendCursor::new)
                    .map_err(|_| Error::InvalidData("append sequence is negative".into()))
            })
            .transpose()?;
        let changes: Vec<Change> = rows
            .into_iter()
            .map(ChangeRow::try_into_change)
            .collect::<std::result::Result<_, Error>>()?;
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
        let row: Option<ChangeRow> = sqlx::query_as(GET_BY_ID)
            .bind(id.to_string())
            .bind(scope.as_str())
            .fetch_optional(&self.pool)
            .await?;
        row.map(ChangeRow::try_into_change).transpose()
    }
}

#[derive(sqlx::FromRow)]
struct ChangeRow {
    append_seq: i64,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_change(millis: u64) -> Change {
        let row_id = Uuid::now_v7();
        Change::new(
            Hlc::new(palladium_core::NodeId::new(), millis),
            vec![Op::Insert {
                table: "todos".into(),
                row_id,
                data: json!({"id": row_id}),
            }],
        )
    }

    #[tokio::test]
    async fn append_page_and_duplicate_scope() -> std::result::Result<(), Box<dyn std::error::Error>>
    {
        let store = SqliteStore::in_memory().await?;
        let scope = Scope::new("a");
        let c = make_change(1);
        let first = store.insert(&scope, &c).await?;
        let second = store.insert(&scope, &c).await?;
        assert!(matches!(first, palladium_core::InsertOutcome::Inserted(_)));
        assert!(matches!(
            second,
            palladium_core::InsertOutcome::Duplicate(_)
        ));
        assert_eq!(store.page(&scope, None, 1).await?.changes.len(), 1);
        Ok(())
    }

    #[tokio::test]
    async fn concurrent_identical_inserts_return_inserted_and_duplicate(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let store = SqliteStore::in_memory().await?;
        let scope = Scope::new("a");
        let change = make_change(1);

        let (first, second) =
            tokio::join!(store.insert(&scope, &change), store.insert(&scope, &change));
        let outcomes = [first?, second?];
        assert!(outcomes
            .iter()
            .any(|outcome| matches!(outcome, palladium_core::InsertOutcome::Inserted(_))));
        assert!(outcomes
            .iter()
            .any(|outcome| matches!(outcome, palladium_core::InsertOutcome::Duplicate(_))));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_change_beyond_v1_future_window_as_clock_skew(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let store = SqliteStore::in_memory().await?;
        let scope = Scope::new("a");
        let change = make_change(i64::MAX as u64);

        let result = store.insert(&scope, &change).await;
        assert!(matches!(
            result,
            Err(Error::InvalidData(classification)) if classification == "clock_skew"
        ));
        Ok(())
    }

    #[tokio::test]
    async fn page_cursor_uses_actual_interleaved_append_position(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let store = SqliteStore::in_memory().await?;
        let scope_a = Scope::new("a");
        let scope_b = Scope::new("b");
        let change = |millis| make_change(millis);

        store.insert(&scope_a, &change(1)).await?;
        for millis in 2..=6 {
            store.insert(&scope_b, &change(millis)).await?;
        }
        store.insert(&scope_a, &change(7)).await?;

        let first = store.page(&scope_a, None, 1).await?;
        assert_eq!(
            first
                .cursor
                .as_ref()
                .map(palladium_core::AppendCursor::as_str),
            Some("1")
        );
        assert!(!first.caught_up);

        let second = store.page(&scope_a, first.cursor.as_ref(), 1).await?;
        assert_eq!(
            second
                .cursor
                .as_ref()
                .map(palladium_core::AppendCursor::as_str),
            Some("7")
        );
        assert!(second.caught_up);
        Ok(())
    }

    #[tokio::test]
    async fn legacy_history_is_rebuilt_with_append_positions_and_hashes(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::query(
            "CREATE TABLE palladium_changes (
                id TEXT PRIMARY KEY,
                hlc_key TEXT NOT NULL,
                hlc_millis INTEGER NOT NULL,
                hlc_counter INTEGER NOT NULL,
                hlc_node_id TEXT NOT NULL,
                ops_json TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await?;
        let id = Uuid::nil().to_string();
        let node_id = Uuid::nil().to_string();
        sqlx::query(
            "INSERT INTO palladium_changes
             (id, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json)
             VALUES (?, 'legacy', 1, 0, ?, '[]')",
        )
        .bind(&id)
        .bind(node_id)
        .execute(&pool)
        .await?;

        migrate(&pool).await?;

        let row: (i64, String, String) = sqlx::query_as(
            "SELECT append_seq, scope, payload_hash FROM palladium_changes WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&pool)
        .await?;
        assert_eq!(row.0, 1);
        assert_eq!(row.1, "default");
        assert_eq!(row.2.len(), 64);
        Ok(())
    }
}
