//! Metadata store for blobs persisted in a `SQLite` (or `Postgres`) database.
//!
//! The `_blob_metadata` table records provenance, size, MIME type, and
//! soft-delete information for every blob managed by the engine.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::BlobError;

/// SQL DDL for the blob metadata table and its indexes.
pub const MIGRATION_SQL: &str = r"
CREATE TABLE IF NOT EXISTS _blob_metadata (
    id          TEXT    NOT NULL PRIMARY KEY,
    mime_type   TEXT    NOT NULL,
    size_bytes  INTEGER NOT NULL,
    filename    TEXT,
    sha256      TEXT,
    created_at  TEXT    NOT NULL,
    deleted_at  TEXT,
    ttl_secs    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_blob_sha256  ON _blob_metadata (sha256);
CREATE INDEX IF NOT EXISTS idx_blob_deleted ON _blob_metadata (deleted_at);
";

/// Raw row type returned by `sqlx` for the metadata table.
type MetaRow = (
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
    Option<i64>,
);

/// Persisted metadata record for a single blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobMetadata {
    /// The blob's unique identifier.
    pub id: Uuid,
    /// The MIME type reported at upload time (e.g. `"image/png"`).
    pub mime_type: String,
    /// The blob size in bytes.
    pub size_bytes: u64,
    /// Optional original filename supplied by the uploader.
    pub filename: Option<String>,
    /// Hex-encoded SHA-256 digest of the blob bytes.
    pub sha256: Option<String>,
    /// ISO-8601 timestamp of when the blob was stored.
    pub created_at: String,
    /// ISO-8601 timestamp of when the blob was soft-deleted, if applicable.
    pub deleted_at: Option<String>,
    /// Number of seconds after `deleted_at` before the bytes may be purged.
    pub ttl_secs: Option<u64>,
}

/// Convert a raw `MetaRow` tuple into a [`BlobMetadata`].
///
/// `SQLite` stores integers as `i64`; we cast back to `u64` for the public API.
#[allow(clippy::cast_sign_loss)]
fn row_to_meta(
    (id_str, mime_type, size_bytes, filename, sha256, created_at, deleted_at, ttl_secs): MetaRow,
) -> BlobMetadata {
    BlobMetadata {
        id: id_str.parse().unwrap_or(Uuid::nil()),
        mime_type,
        size_bytes: size_bytes as u64,
        filename,
        sha256,
        created_at,
        deleted_at,
        ttl_secs: ttl_secs.map(|v| v as u64),
    }
}

/// Run the `_blob_metadata` schema migration against `pool`.
///
/// Safe to call multiple times — uses `CREATE TABLE IF NOT EXISTS`.
///
/// # Errors
///
/// Returns an error if any SQL statement fails.
pub async fn run_migration(pool: &SqlitePool) -> Result<(), BlobError> {
    for stmt in MIGRATION_SQL
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sqlx::query(stmt)
            .execute(pool)
            .await
            .map_err(|e| BlobError::Backend(e.to_string()))?;
    }
    Ok(())
}

/// Insert a metadata record into `_blob_metadata`.
///
/// # Errors
///
/// Returns an error if the insert fails (e.g. duplicate `id`).
#[allow(clippy::cast_possible_wrap)]
pub async fn insert(pool: &SqlitePool, meta: &BlobMetadata) -> Result<(), BlobError> {
    sqlx::query(
        "INSERT INTO _blob_metadata \
         (id, mime_type, size_bytes, filename, sha256, created_at, deleted_at, ttl_secs) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(meta.id.to_string())
    .bind(&meta.mime_type)
    .bind(meta.size_bytes as i64)
    .bind(&meta.filename)
    .bind(&meta.sha256)
    .bind(&meta.created_at)
    .bind(&meta.deleted_at)
    .bind(meta.ttl_secs.map(|v| v as i64))
    .execute(pool)
    .await
    .map_err(|e| BlobError::Backend(e.to_string()))?;
    Ok(())
}

/// Retrieve a metadata record by `id`.
///
/// Returns `Ok(None)` if no record with that id exists.
///
/// # Errors
///
/// Returns an error on database failure.
pub async fn get(pool: &SqlitePool, id: Uuid) -> Result<Option<BlobMetadata>, BlobError> {
    let row: Option<MetaRow> = sqlx::query_as(
        "SELECT id, mime_type, size_bytes, filename, sha256, \
         created_at, deleted_at, ttl_secs \
         FROM _blob_metadata WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(pool)
    .await
    .map_err(|e| BlobError::Backend(e.to_string()))?;

    Ok(row.map(row_to_meta))
}

/// Mark a blob as soft-deleted by setting `deleted_at` to the current UTC
/// time and recording `ttl_secs`.
///
/// # Errors
///
/// Returns [`BlobError::NotFound`] if `id` does not exist.
/// Returns other errors on database failure.
#[allow(clippy::cast_possible_wrap)]
pub async fn soft_delete(
    pool: &SqlitePool,
    id: Uuid,
    ttl_secs: Option<u64>,
) -> Result<(), BlobError> {
    let now = now_utc_iso8601();
    let affected = sqlx::query(
        "UPDATE _blob_metadata \
         SET deleted_at = ?, ttl_secs = ? \
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&now)
    .bind(ttl_secs.map(|v| v as i64))
    .bind(id.to_string())
    .execute(pool)
    .await
    .map_err(|e| BlobError::Backend(e.to_string()))?
    .rows_affected();

    if affected == 0 {
        Err(BlobError::NotFound(id))
    } else {
        Ok(())
    }
}

/// List all blobs whose TTL has expired (i.e. `deleted_at + ttl_secs < now`).
///
/// # Errors
///
/// Returns an error on database failure.
pub async fn list_expired(pool: &SqlitePool) -> Result<Vec<BlobMetadata>, BlobError> {
    let rows: Vec<MetaRow> = sqlx::query_as(
        "SELECT id, mime_type, size_bytes, filename, sha256, \
         created_at, deleted_at, ttl_secs \
         FROM _blob_metadata \
         WHERE deleted_at IS NOT NULL \
           AND ttl_secs IS NOT NULL \
           AND datetime(deleted_at, '+' || ttl_secs || ' seconds') < datetime('now')",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| BlobError::Backend(e.to_string()))?;

    Ok(rows.into_iter().map(row_to_meta).collect())
}

/// Returns the current UTC time formatted as `YYYY-MM-DDTHH:MM:SSZ`.
fn now_utc_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs = now % 60;
    let mins = (now / 60) % 60;
    let hours = (now / 3600) % 24;
    let days_since_epoch = now / 86400;
    let (year, month, day) = days_to_ymd(days_since_epoch);
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{mins:02}:{secs:02}Z")
}

/// Convert a count of days since the Unix epoch to `(year, month, day)`.
//
// Variable names (`doe` = day-of-era, `doy` = day-of-year, `yoe` = year-of-era,
// `mp` = month-prime) follow Howard Hinnant's "days_from_civil" reference
// algorithm. Renaming for clippy::similar_names would diverge from the canonical
// presentation and make it harder to audit against the source.
#[allow(clippy::similar_names)]
const fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Shift epoch from 1970-01-01 to 0001-03-01 for simpler leap-year math.
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    async fn make_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        run_migration(&pool).await.unwrap();
        pool
    }

    fn sample_meta(id: Uuid) -> BlobMetadata {
        BlobMetadata {
            id,
            mime_type: "image/png".into(),
            size_bytes: 1024,
            filename: Some("photo.png".into()),
            sha256: Some("abc123".into()),
            created_at: "2024-01-01T00:00:00Z".into(),
            deleted_at: None,
            ttl_secs: None,
        }
    }

    #[tokio::test]
    async fn insert_and_get_round_trip() {
        let pool = make_pool().await;
        let id = Uuid::new_v4();
        let meta = sample_meta(id);
        insert(&pool, &meta).await.unwrap();
        let got = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(got.id, meta.id);
        assert_eq!(got.mime_type, meta.mime_type);
        assert_eq!(got.size_bytes, meta.size_bytes);
        assert_eq!(got.filename, meta.filename);
        assert_eq!(got.sha256, meta.sha256);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = make_pool().await;
        let result = get(&pool, Uuid::new_v4()).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn soft_delete_sets_deleted_at() {
        let pool = make_pool().await;
        let id = Uuid::new_v4();
        insert(&pool, &sample_meta(id)).await.unwrap();
        soft_delete(&pool, id, Some(3600)).await.unwrap();
        let got = get(&pool, id).await.unwrap().unwrap();
        assert!(got.deleted_at.is_some());
        assert_eq!(got.ttl_secs, Some(3600));
    }

    #[tokio::test]
    async fn soft_delete_missing_returns_not_found() {
        let pool = make_pool().await;
        let err = soft_delete(&pool, Uuid::new_v4(), None).await.unwrap_err();
        assert!(matches!(err, BlobError::NotFound(_)));
    }

    #[tokio::test]
    async fn list_expired_returns_only_expired() {
        let pool = make_pool().await;
        let id = Uuid::new_v4();
        // Insert a blob with a past deleted_at and ttl_secs = 1.
        let meta = BlobMetadata {
            id,
            mime_type: "text/plain".into(),
            size_bytes: 10,
            filename: None,
            sha256: None,
            created_at: "2000-01-01T00:00:00Z".into(),
            deleted_at: Some("2000-01-01T00:00:01Z".into()),
            ttl_secs: Some(1),
        };
        insert(&pool, &meta).await.unwrap();
        let expired = list_expired(&pool).await.unwrap();
        assert!(!expired.is_empty());
        assert_eq!(expired[0].id, id);
    }
}
