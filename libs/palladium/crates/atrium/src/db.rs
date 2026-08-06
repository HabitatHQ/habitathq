//! Atrium's own `SQLite` database: users, workspaces, memberships, invites.
//!
//! This is **separate** from Palladium's change store. Palladium stores the raw
//! change log (opaque, scoped by workspace id); Atrium stores the tenancy and
//! (in Phase 3b) the record-level ACL truth.

use std::{str::FromStr, time::SystemTime};

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::error::AtriumError;

const MIGRATE: &str = "
CREATE TABLE IF NOT EXISTS app_users (
    user_id    TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS workspaces (
    id         TEXT    NOT NULL PRIMARY KEY,
    created_by TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
    workspace_id TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
    token        TEXT    NOT NULL PRIMARY KEY,
    workspace_id TEXT    NOT NULL,
    created_by   TEXT    NOT NULL,
    accepted_by  TEXT,
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    row_id        TEXT NOT NULL PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    root_id       TEXT,
    owner_user_id TEXT NOT NULL,
    sharing       TEXT NOT NULL DEFAULT 'private'
);
CREATE INDEX IF NOT EXISTS idx_records_workspace ON records (workspace_id);
CREATE TABLE IF NOT EXISTS shares (
    root_id          TEXT NOT NULL,
    grantee_user_id  TEXT NOT NULL,
    perm             TEXT NOT NULL,
    PRIMARY KEY (root_id, grantee_user_id)
);
CREATE TABLE IF NOT EXISTS grant_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   TEXT    NOT NULL,
    root_id   TEXT    NOT NULL,
    kind      TEXT    NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS blobs (
    blob_id       TEXT    NOT NULL PRIMARY KEY,
    workspace_id  TEXT    NOT NULL,
    note_id       TEXT    NOT NULL,
    owner_user_id TEXT    NOT NULL,
    content_type  TEXT    NOT NULL,
    bytes         BLOB    NOT NULL,
    created_at    INTEGER NOT NULL
);
";

/// Sharing class: private to the owner (default).
pub const SHARING_PRIVATE: &str = "private";
/// Sharing class: readable by every workspace member.
pub const SHARING_HOUSEHOLD_READ: &str = "household_read";
/// Sharing class: read/write for every workspace member.
pub const SHARING_HOUSEHOLD_RW: &str = "household_rw";
/// Per-member grant permission: read-only.
pub const PERM_READ: &str = "read";
/// Per-member grant permission: read/write.
pub const PERM_WRITE: &str = "write";
/// A grant event: a root became visible to a user (triggers backfill).
pub const EVENT_GRANT: &str = "grant";
/// A revoke event: a root became invisible to a user (triggers purge).
pub const EVENT_REVOKE: &str = "revoke";

/// Ownership + sharing metadata for one synced row (Atrium's ACL truth).
#[derive(Debug, Clone)]
pub struct AclRecord {
    /// The row this record describes.
    pub row_id: String,
    /// Owning workspace.
    pub workspace_id: String,
    /// Source table (root or child).
    pub table_name: String,
    /// For children, the aggregate root they inherit ACL from; `None` for roots.
    pub root_id: Option<String>,
    /// Creator (Atrium-set from identity, never the client payload).
    pub owner_user_id: String,
    /// Sharing class of a root (`private` / `household_read` / `household_rw`).
    pub sharing: String,
}

/// A stored blob (e.g. a `note_images` payload) and its parent-note linkage.
///
/// Blob bytes travel outside the JSON change stream; the blob inherits its ACL
/// from `note_id` (the owning aggregate root, `D18`).
#[derive(Debug, Clone)]
pub struct BlobRecord {
    /// The blob's id (client-chosen UUID).
    pub blob_id: String,
    /// Owning workspace.
    pub workspace_id: String,
    /// The note (aggregate root) whose ACL gates this blob.
    pub note_id: String,
    /// Uploader (Atrium-set from identity, never the client payload).
    pub owner_user_id: String,
    /// MIME type to echo back on read.
    pub content_type: String,
    /// Raw bytes.
    pub bytes: Vec<u8>,
}

/// Role of a member within a workspace.
pub const ROLE_OWNER: &str = "owner";
/// A non-owner workspace member.
pub const ROLE_MEMBER: &str = "member";

/// Milliseconds since the Unix epoch (0 if the clock predates the epoch).
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

/// Atrium's tenancy database.
#[derive(Debug, Clone)]
pub struct AtriumDb {
    pool: SqlitePool,
}

impl AtriumDb {
    /// Open (or create) the Atrium database at `url` and run migrations.
    ///
    /// # Errors
    /// Returns an error if the pool cannot be created or migration fails.
    pub async fn open(url: &str) -> Result<Self, AtriumError> {
        let opts = SqliteConnectOptions::from_str(url)
            .map_err(AtriumError::internal)?
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(opts)
            .await
            .map_err(AtriumError::internal)?;
        sqlx::query(MIGRATE).execute(&pool).await?;
        Ok(Self { pool })
    }

    /// Open an ephemeral, uniquely-named in-memory database (for tests).
    ///
    /// # Errors
    /// Returns an error if the in-memory pool cannot be initialised.
    #[cfg(test)]
    pub async fn in_memory() -> Result<Self, AtriumError> {
        let id = Uuid::new_v4().simple();
        Self::open(&format!("sqlite:file:atrium-{id}?mode=memory&cache=shared")).await
    }

    /// Ensure a user row exists (idempotent).
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn upsert_user(&self, user: &str) -> Result<(), AtriumError> {
        sqlx::query("INSERT OR IGNORE INTO app_users (user_id) VALUES (?)")
            .bind(user)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Create a workspace with `creator` as its owner. Returns the new id.
    ///
    /// # Errors
    /// Returns an error if any write fails.
    pub async fn create_workspace(&self, creator: &str) -> Result<String, AtriumError> {
        let id = Uuid::new_v4().to_string();
        self.upsert_user(creator).await?;
        sqlx::query("INSERT INTO workspaces (id, created_by, created_at) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(creator)
            .bind(now_millis())
            .execute(&self.pool)
            .await?;
        sqlx::query("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(creator)
            .bind(ROLE_OWNER)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    /// Workspace ids `user` belongs to.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn workspaces_for(&self, user: &str) -> Result<Vec<String>, AtriumError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY workspace_id",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// The caller's role in `workspace`, or `None` if not a member.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn role_of(&self, workspace: &str, user: &str) -> Result<Option<String>, AtriumError> {
        let role = sqlx::query_scalar::<_, String>(
            "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(workspace)
        .bind(user)
        .fetch_optional(&self.pool)
        .await?;
        Ok(role)
    }

    /// Require that `user` is a member of `workspace`, returning their role.
    ///
    /// # Errors
    /// [`AtriumError::Forbidden`] if not a member; other errors on query failure.
    pub async fn require_member(
        &self,
        workspace: &str,
        user: &str,
    ) -> Result<String, AtriumError> {
        self.role_of(workspace, user)
            .await?
            .ok_or_else(|| AtriumError::Forbidden(format!("not a member of workspace {workspace}")))
    }

    /// Require that `user` is the **owner** of `workspace`.
    ///
    /// # Errors
    /// [`AtriumError::Forbidden`] if not the owner; other errors on query failure.
    pub async fn require_owner(&self, workspace: &str, user: &str) -> Result<(), AtriumError> {
        match self.role_of(workspace, user).await?.as_deref() {
            Some(ROLE_OWNER) => Ok(()),
            _ => Err(AtriumError::Forbidden(format!(
                "not the owner of workspace {workspace}"
            ))),
        }
    }

    /// Mint an invite token for `workspace`. Caller must be the owner.
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn create_invite(
        &self,
        workspace: &str,
        creator: &str,
    ) -> Result<String, AtriumError> {
        let token = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO invites (token, workspace_id, created_by, accepted_by, created_at) \
             VALUES (?, ?, ?, NULL, ?)",
        )
        .bind(&token)
        .bind(workspace)
        .bind(creator)
        .bind(now_millis())
        .execute(&self.pool)
        .await?;
        Ok(token)
    }

    /// Accept an invite: `user` joins the invite's workspace as a member.
    /// Returns the workspace id.
    ///
    /// # Errors
    /// [`AtriumError::NotFound`] if the token is unknown or already used;
    /// other errors on write failure.
    pub async fn accept_invite(&self, token: &str, user: &str) -> Result<String, AtriumError> {
        let workspace = sqlx::query_scalar::<_, String>(
            "SELECT workspace_id FROM invites WHERE token = ? AND accepted_by IS NULL",
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtriumError::NotFound("invite not found or already used".to_owned()))?;

        self.upsert_user(user).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)",
        )
        .bind(&workspace)
        .bind(user)
        .bind(ROLE_MEMBER)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE invites SET accepted_by = ? WHERE token = ?")
            .bind(user)
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(workspace)
    }

    /// `(user_id, role)` for every member of `workspace`.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn members(&self, workspace: &str) -> Result<Vec<(String, String)>, AtriumError> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT user_id, role FROM memberships WHERE workspace_id = ? ORDER BY user_id",
        )
        .bind(workspace)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// All member ids of `workspace`.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn member_ids(&self, workspace: &str) -> Result<Vec<String>, AtriumError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT user_id FROM memberships WHERE workspace_id = ? ORDER BY user_id",
        )
        .bind(workspace)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    // ── Record-level ACL (Phase 3b) ─────────────────────────────────────────

    /// Fetch the ACL record for `row_id`, if Atrium has seen it.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn get_record(&self, row_id: &str) -> Result<Option<AclRecord>, AtriumError> {
        let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, String)>(
            "SELECT row_id, workspace_id, table_name, root_id, owner_user_id, sharing \
             FROM records WHERE row_id = ?",
        )
        .bind(row_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(
            |(row_id, workspace_id, table_name, root_id, owner_user_id, sharing)| AclRecord {
                row_id,
                workspace_id,
                table_name,
                root_id,
                owner_user_id,
                sharing,
            },
        ))
    }

    /// Insert an ACL record if absent (idempotent; never changes an owner).
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn insert_record(
        &self,
        row_id: &str,
        workspace: &str,
        table: &str,
        root_id: Option<&str>,
        owner: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "INSERT OR IGNORE INTO records \
             (row_id, workspace_id, table_name, root_id, owner_user_id, sharing) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(row_id)
        .bind(workspace)
        .bind(table)
        .bind(root_id)
        .bind(owner)
        .bind(SHARING_PRIVATE)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Set a root's sharing class.
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn set_sharing(&self, root_id: &str, sharing: &str) -> Result<(), AtriumError> {
        sqlx::query("UPDATE records SET sharing = ? WHERE row_id = ?")
            .bind(sharing)
            .bind(root_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Grant `grantee` a per-member `perm` on `root_id` (upsert).
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn add_share(
        &self,
        root_id: &str,
        grantee: &str,
        perm: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query("INSERT OR REPLACE INTO shares (root_id, grantee_user_id, perm) VALUES (?, ?, ?)")
            .bind(root_id)
            .bind(grantee)
            .bind(perm)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Remove `grantee`'s per-member grant on `root_id`.
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn remove_share(&self, root_id: &str, grantee: &str) -> Result<(), AtriumError> {
        sqlx::query("DELETE FROM shares WHERE root_id = ? AND grantee_user_id = ?")
            .bind(root_id)
            .bind(grantee)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The permission `grantee` holds on `root_id`, if any.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn get_share(
        &self,
        root_id: &str,
        grantee: &str,
    ) -> Result<Option<String>, AtriumError> {
        let perm = sqlx::query_scalar::<_, String>(
            "SELECT perm FROM shares WHERE root_id = ? AND grantee_user_id = ?",
        )
        .bind(root_id)
        .bind(grantee)
        .fetch_optional(&self.pool)
        .await?;
        Ok(perm)
    }

    /// Enqueue a grant/revoke event for `user` on `root_id`.
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn enqueue_event(
        &self,
        user: &str,
        root_id: &str,
        kind: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query("INSERT INTO grant_events (user_id, root_id, kind) VALUES (?, ?, ?)")
            .bind(user)
            .bind(root_id)
            .bind(kind)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Undelivered `kind` events for `user`, as `(event_id, root_id)`.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn pending_events(
        &self,
        user: &str,
        kind: &str,
    ) -> Result<Vec<(i64, String)>, AtriumError> {
        let rows = sqlx::query_as::<_, (i64, String)>(
            "SELECT id, root_id FROM grant_events \
             WHERE user_id = ? AND kind = ? AND delivered = 0 ORDER BY id",
        )
        .bind(user)
        .bind(kind)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Mark the given event ids delivered.
    ///
    /// # Errors
    /// Returns an error if a write fails.
    pub async fn mark_delivered(&self, ids: &[i64]) -> Result<(), AtriumError> {
        for id in ids {
            sqlx::query("UPDATE grant_events SET delivered = 1 WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// Resolve a row to its aggregate root's ACL record (self, if a root).
    ///
    /// # Errors
    /// Returns an error if a query fails.
    pub async fn effective_root(&self, row_id: &str) -> Result<Option<AclRecord>, AtriumError> {
        let Some(rec) = self.get_record(row_id).await? else {
            return Ok(None);
        };
        if let Some(root_id) = rec.root_id.as_deref() {
            let root_id = root_id.to_owned();
            self.get_record(&root_id).await
        } else {
            Ok(Some(rec))
        }
    }

    /// Whether `caller` may **read** `row_id` (via its effective root).
    ///
    /// # Errors
    /// Returns an error if a query fails.
    pub async fn can_read(&self, caller: &str, row_id: &str) -> Result<bool, AtriumError> {
        let Some(root) = self.effective_root(row_id).await? else {
            return Ok(false);
        };
        if caller == root.owner_user_id
            || root.sharing == SHARING_HOUSEHOLD_READ
            || root.sharing == SHARING_HOUSEHOLD_RW
        {
            return Ok(true);
        }
        Ok(self.get_share(&root.row_id, caller).await?.is_some())
    }

    /// Whether `caller` may **write** `row_id` (via its effective root).
    ///
    /// # Errors
    /// Returns an error if a query fails.
    pub async fn can_write(&self, caller: &str, row_id: &str) -> Result<bool, AtriumError> {
        let Some(root) = self.effective_root(row_id).await? else {
            return Ok(false);
        };
        if caller == root.owner_user_id || root.sharing == SHARING_HOUSEHOLD_RW {
            return Ok(true);
        }
        Ok(self.get_share(&root.row_id, caller).await?.as_deref() == Some(PERM_WRITE))
    }

    // ── Blob channel (Phase 3c) ─────────────────────────────────────────────

    /// Store (or replace) a blob linked to `note_id` (`D18`). Authorization is
    /// the caller's responsibility — this only persists.
    ///
    /// # Errors
    /// Returns an error if the write fails.
    pub async fn put_blob(
        &self,
        blob_id: &str,
        workspace: &str,
        note_id: &str,
        owner: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "INSERT OR REPLACE INTO blobs \
             (blob_id, workspace_id, note_id, owner_user_id, content_type, bytes, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(blob_id)
        .bind(workspace)
        .bind(note_id)
        .bind(owner)
        .bind(content_type)
        .bind(bytes)
        .bind(now_millis())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a blob and its note linkage, if present.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    pub async fn get_blob(&self, blob_id: &str) -> Result<Option<BlobRecord>, AtriumError> {
        let row = sqlx::query_as::<_, (String, String, String, String, String, Vec<u8>)>(
            "SELECT blob_id, workspace_id, note_id, owner_user_id, content_type, bytes \
             FROM blobs WHERE blob_id = ?",
        )
        .bind(blob_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(
            |(blob_id, workspace_id, note_id, owner_user_id, content_type, bytes)| BlobRecord {
                blob_id,
                workspace_id,
                note_id,
                owner_user_id,
                content_type,
                bytes,
            },
        ))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{AtriumDb, ROLE_MEMBER, ROLE_OWNER};

    #[tokio::test]
    async fn create_workspace_makes_creator_owner() {
        let db = AtriumDb::in_memory().await.unwrap();
        let ws = db.create_workspace("alice").await.unwrap();
        assert_eq!(db.role_of(&ws, "alice").await.unwrap().as_deref(), Some(ROLE_OWNER));
        assert_eq!(db.workspaces_for("alice").await.unwrap(), vec![ws]);
    }

    #[tokio::test]
    async fn invite_and_accept_adds_member() {
        let db = AtriumDb::in_memory().await.unwrap();
        let ws = db.create_workspace("alice").await.unwrap();
        let token = db.create_invite(&ws, "alice").await.unwrap();
        let joined = db.accept_invite(&token, "bob").await.unwrap();
        assert_eq!(joined, ws);
        assert_eq!(db.role_of(&ws, "bob").await.unwrap().as_deref(), Some(ROLE_MEMBER));
        // second use of the same token is rejected
        assert!(db.accept_invite(&token, "carol").await.is_err());
    }

    #[tokio::test]
    async fn require_owner_and_member_enforce_roles() {
        let db = AtriumDb::in_memory().await.unwrap();
        let ws = db.create_workspace("alice").await.unwrap();
        assert!(db.require_owner(&ws, "alice").await.is_ok());
        assert!(db.require_owner(&ws, "bob").await.is_err());
        assert!(db.require_member(&ws, "bob").await.is_err());
    }
}
