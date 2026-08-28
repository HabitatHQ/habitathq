//! Atrium's `SQLite` database: tenancy, ACL metadata, and workspace change log.
// This binary crate exposes its state types for in-process HTTP tests; they are
// not a consumer-facing library API. Route docs remain the public contract.
#![allow(
    missing_docs,
    clippy::missing_errors_doc,
    reason = "Atrium internal state API"
)]
// The legacy ACL schema rebuild must be kept in one transaction for atomicity.
#![allow(clippy::too_many_lines, reason = "atomic legacy ACL migration")]

use std::{str::FromStr, time::SystemTime};

use palladium_core::{Change, Hlc, Op};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AtriumError,
    registry::{self, TableRole},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendOutcome {
    Inserted(i64),
    Duplicate(i64),
}

const MIGRATE: &str = "
CREATE TABLE IF NOT EXISTS app_users (
    user_id TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT NOT NULL PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS member_nodes (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, node_id)
);
CREATE TABLE IF NOT EXISTS invites (
    token TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    accepted_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    workspace_id TEXT NOT NULL,
    row_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    root_id TEXT,
    owner_user_id TEXT NOT NULL,
    sharing TEXT NOT NULL DEFAULT 'private',
    PRIMARY KEY (workspace_id, row_id)
);
CREATE INDEX IF NOT EXISTS idx_records_workspace ON records (workspace_id);
CREATE TABLE IF NOT EXISTS shares (
    workspace_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    grantee_user_id TEXT NOT NULL,
    perm TEXT NOT NULL,
    PRIMARY KEY (workspace_id, root_id, grantee_user_id)
);
CREATE TABLE IF NOT EXISTS grant_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    backfill_cursor INTEGER NOT NULL DEFAULT 0,
    offered_through INTEGER,
    offered_upper_bound INTEGER,
    offered_complete INTEGER
);
CREATE INDEX IF NOT EXISTS idx_grant_events_pending
    ON grant_events (workspace_id, user_id, delivered, id);
CREATE TABLE IF NOT EXISTS palladium_changes (
    id TEXT NOT NULL,
    scope TEXT NOT NULL,
    append_cursor INTEGER NOT NULL UNIQUE,
    hlc_key TEXT NOT NULL,
    hlc_millis INTEGER NOT NULL,
    hlc_counter INTEGER NOT NULL,
    hlc_node_id TEXT NOT NULL,
    ops_json TEXT NOT NULL,
    append_seq INTEGER,
    content_hash TEXT,
    PRIMARY KEY (scope, id)
);
CREATE TABLE IF NOT EXISTS atrium_append_sequence (
    id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    next_seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
    blob_id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes BLOB NOT NULL,
    created_at INTEGER NOT NULL
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
/// Conservative maximum blob payload accepted by Atrium.
pub const MAX_BLOB_BYTES: usize = 16 * 1024 * 1024;
/// A grant event: a root became visible to a user (triggers backfill).
pub const EVENT_GRANT: &str = "grant";
/// A revoke event: a root became invisible to a user (triggers purge).
pub const EVENT_REVOKE: &str = "revoke";
/// Role of a member within a workspace.
pub const ROLE_OWNER: &str = "owner";
/// A non-owner workspace member.
pub const ROLE_MEMBER: &str = "member";

/// Ownership + sharing metadata for one synced row (Atrium's ACL truth).
#[derive(Debug, Clone)]
pub struct AclRecord {
    pub row_id: String,
    pub workspace_id: String,
    pub table_name: String,
    pub root_id: Option<String>,
    pub owner_user_id: String,
    pub sharing: String,
}

/// A pending grant or revoke event returned to a synchronizing client.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingEvent {
    pub id: i64,
    pub kind: String,
    pub root_id: String,
}

/// A stored blob (e.g. a `note_images` payload) and its parent-note linkage.
#[derive(Debug, Clone)]
pub struct BlobRecord {
    pub blob_id: String,
    pub workspace_id: String,
    pub note_id: String,
    pub owner_user_id: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// A stored change together with Atrium's durable append sequence.
#[derive(Debug, Clone)]
pub struct SequencedChange {
    pub append_seq: i64,
    pub change: Change,
}

/// Milliseconds since the Unix epoch (0 if the clock predates the epoch).
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

/// Atrium's one backing database for tenancy, ACL truth, and changes.
#[derive(Debug, Clone)]
pub struct AtriumDb {
    pool: SqlitePool,
}

impl AtriumDb {
    /// Open (or create) Atrium's database at `url` and safely upgrade its schema.
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
        Self::upgrade_workspace_qualified_schema(&pool).await?;
        Self::upgrade_grant_backfill_schema(&pool).await?;
        Self::upgrade_change_cursor_schema(&pool).await?;
        Self::upgrade_change_append_sequence(&pool).await?;
        Self::upgrade_change_append_payload(&pool).await?;
        Self::upgrade_change_history_primary_key(&pool).await?;
        Ok(Self { pool })
    }

    async fn upgrade_change_append_payload(pool: &SqlitePool) -> Result<(), AtriumError> {
        if !Self::table_has_column(pool, "palladium_changes", "content_hash").await? {
            sqlx::query("ALTER TABLE palladium_changes ADD COLUMN content_hash TEXT")
                .execute(pool)
                .await?;
        }
        let rows: Vec<(String, String, i64, i64, String, String)> = sqlx::query_as(
            "SELECT id, scope, hlc_millis, hlc_counter, hlc_node_id, ops_json
               FROM palladium_changes
              WHERE content_hash IS NULL OR content_hash = ''",
        )
        .fetch_all(pool)
        .await?;
        for (id, scope, millis, counter, node_id, ops_json) in rows {
            let id = Uuid::parse_str(&id).map_err(AtriumError::internal)?;
            let hlc =
                Hlc::from_db_parts(millis, counter, &node_id).map_err(AtriumError::BadRequest)?;
            let ops: Vec<Op> = serde_json::from_str(&ops_json).map_err(AtriumError::internal)?;
            let canonical =
                serde_json::to_vec(&Change { id, hlc, ops }).map_err(AtriumError::internal)?;
            let hash = format!("{:x}", Sha256::digest(canonical));
            sqlx::query("UPDATE palladium_changes SET content_hash = ? WHERE scope = ? AND id = ?")
                .bind(hash)
                .bind(scope)
                .bind(id.to_string())
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    async fn upgrade_change_history_primary_key(pool: &SqlitePool) -> Result<(), AtriumError> {
        if Self::table_has_primary_key(pool, "palladium_changes", &["scope", "id"]).await? {
            return Ok(());
        }
        let mut tx = pool.begin().await?;
        sqlx::query(
            "CREATE TABLE palladium_changes_replacement (
                id TEXT NOT NULL,
                scope TEXT NOT NULL,
                append_cursor INTEGER NOT NULL UNIQUE,
                hlc_key TEXT NOT NULL,
                hlc_millis INTEGER NOT NULL,
                hlc_counter INTEGER NOT NULL,
                hlc_node_id TEXT NOT NULL,
                ops_json TEXT NOT NULL,
                append_seq INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                PRIMARY KEY (scope, id)
            )",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO palladium_changes_replacement
             (id, scope, append_cursor, hlc_key, hlc_millis, hlc_counter, hlc_node_id,
              ops_json, append_seq, content_hash)
             SELECT id, scope, append_cursor, hlc_key, hlc_millis, hlc_counter, hlc_node_id,
                    ops_json, append_seq, content_hash
               FROM palladium_changes",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query("DROP TABLE palladium_changes")
            .execute(&mut *tx)
            .await?;
        sqlx::query("ALTER TABLE palladium_changes_replacement RENAME TO palladium_changes")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "CREATE INDEX idx_changes_scope_append_cursor
             ON palladium_changes (scope, append_cursor)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX idx_changes_append_seq
             ON palladium_changes (append_seq)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "CREATE INDEX idx_changes_scope_append_seq
             ON palladium_changes (scope, append_seq)",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn upgrade_change_cursor_schema(pool: &SqlitePool) -> Result<(), AtriumError> {
        let columns = sqlx::query_as::<_, (String,)>(
            "SELECT name FROM pragma_table_info('palladium_changes')",
        )
        .fetch_all(pool)
        .await?;
        if !columns.iter().any(|(name,)| name == "scope") {
            sqlx::query("ALTER TABLE palladium_changes ADD COLUMN scope TEXT")
                .execute(pool)
                .await?;
            sqlx::query("UPDATE palladium_changes SET scope = 'default' WHERE scope IS NULL")
                .execute(pool)
                .await?;
        }
        if !columns.iter().any(|(name,)| name == "append_cursor") {
            sqlx::query("ALTER TABLE palladium_changes ADD COLUMN append_cursor INTEGER")
                .execute(pool)
                .await?;
            sqlx::query(
                "UPDATE palladium_changes SET append_cursor = rowid
                 WHERE append_cursor IS NULL",
            )
            .execute(pool)
            .await?;
        }
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_changes_append_cursor
             ON palladium_changes (append_cursor)",
        )
        .execute(pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_changes_scope_append_cursor
             ON palladium_changes (scope, append_cursor)",
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn table_has_primary_key(
        pool: &SqlitePool,
        table: &str,
        expected: &[&str],
    ) -> Result<bool, AtriumError> {
        let columns = sqlx::query_as::<_, (String, i64)>(&format!(
            "SELECT name, pk FROM pragma_table_info('{table}') WHERE pk > 0 ORDER BY pk"
        ))
        .fetch_all(pool)
        .await?;
        Ok(columns
            .iter()
            .map(|(name, _)| name.as_str())
            .eq(expected.iter().copied()))
    }

    async fn table_has_column(
        pool: &SqlitePool,
        table: &str,
        column: &str,
    ) -> Result<bool, AtriumError> {
        Ok(sqlx::query_scalar::<_, String>(&format!(
            "SELECT name FROM pragma_table_info('{table}') WHERE name = ?"
        ))
        .bind(column)
        .fetch_optional(pool)
        .await?
        .is_some())
    }
    /// Rebuild legacy global-id ACL tables once, preserving resolvable rows.
    async fn upgrade_workspace_qualified_schema(pool: &SqlitePool) -> Result<(), AtriumError> {
        let records_current =
            Self::table_has_primary_key(pool, "records", &["workspace_id", "row_id"]).await?;
        let shares_current = Self::table_has_primary_key(
            pool,
            "shares",
            &["workspace_id", "root_id", "grantee_user_id"],
        )
        .await?;
        let events_current = Self::table_has_primary_key(pool, "grant_events", &["id"]).await?
            && sqlx::query_scalar::<_, String>(
                "SELECT name FROM pragma_table_info('grant_events') WHERE name = 'workspace_id'",
            )
            .fetch_optional(pool)
            .await?
            .is_some();
        if records_current && shares_current && events_current {
            return Ok(());
        }

        let mut tx = pool.begin().await?;
        if !records_current {
            sqlx::query(
                "CREATE TABLE records_replacement (
                    workspace_id TEXT NOT NULL,
                    row_id TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    root_id TEXT,
                    owner_user_id TEXT NOT NULL,
                    sharing TEXT NOT NULL DEFAULT 'private',
                    PRIMARY KEY (workspace_id, row_id)
                )",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO records_replacement
                 (workspace_id, row_id, table_name, root_id, owner_user_id, sharing)
                 SELECT workspace_id, row_id, table_name, root_id, owner_user_id, sharing FROM records",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query("DROP TABLE records").execute(&mut *tx).await?;
            sqlx::query("ALTER TABLE records_replacement RENAME TO records")
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_records_workspace ON records (workspace_id)",
            )
            .execute(&mut *tx)
            .await?;
        }
        if !shares_current {
            sqlx::query(
                "CREATE TABLE shares_replacement (
                    workspace_id TEXT NOT NULL,
                    root_id TEXT NOT NULL,
                    grantee_user_id TEXT NOT NULL,
                    perm TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, root_id, grantee_user_id)
                )",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO shares_replacement (workspace_id, root_id, grantee_user_id, perm)
                 SELECT records.workspace_id, shares.root_id, shares.grantee_user_id, shares.perm
                 FROM shares JOIN records ON records.row_id = shares.root_id
                 WHERE records.root_id IS NULL",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query("DROP TABLE shares").execute(&mut *tx).await?;
            sqlx::query("ALTER TABLE shares_replacement RENAME TO shares")
                .execute(&mut *tx)
                .await?;
        }
        if !events_current {
            sqlx::query(
                "CREATE TABLE grant_events_replacement (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    root_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    delivered INTEGER NOT NULL DEFAULT 0
                )",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO grant_events_replacement (id, workspace_id, user_id, root_id, kind, delivered)
                 SELECT grant_events.id, records.workspace_id, grant_events.user_id,
                        grant_events.root_id, grant_events.kind, grant_events.delivered
                 FROM grant_events JOIN records ON records.row_id = grant_events.root_id
                 WHERE records.root_id IS NULL",
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query("DROP TABLE grant_events")
                .execute(&mut *tx)
                .await?;
            sqlx::query("ALTER TABLE grant_events_replacement RENAME TO grant_events")
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "CREATE INDEX IF NOT EXISTS idx_grant_events_pending
                 ON grant_events (workspace_id, user_id, delivered, id)",
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Add durable acknowledgement and offer state to grant events.
    async fn upgrade_grant_backfill_schema(pool: &SqlitePool) -> Result<(), AtriumError> {
        for (column, definition) in [
            ("backfill_cursor", "INTEGER NOT NULL DEFAULT 0"),
            ("offered_through", "INTEGER"),
            ("offered_upper_bound", "INTEGER"),
            ("offered_complete", "INTEGER"),
        ] {
            if !Self::table_has_column(pool, "grant_events", column).await? {
                sqlx::query(&format!(
                    "ALTER TABLE grant_events ADD COLUMN {column} {definition}"
                ))
                .execute(pool)
                .await?;
            }
        }
        Ok(())
    }

    /// Add a durable, server-assigned append cursor to legacy change history.
    async fn upgrade_change_append_sequence(pool: &SqlitePool) -> Result<(), AtriumError> {
        let has_append_seq =
            Self::table_has_column(pool, "palladium_changes", "append_seq").await?;
        let mut tx = pool.begin().await?;
        if !has_append_seq {
            sqlx::query("ALTER TABLE palladium_changes ADD COLUMN append_seq INTEGER")
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY rowid) AS ordinal
                FROM palladium_changes
                WHERE append_seq IS NULL
            ),
            base AS (
                SELECT COALESCE(MAX(append_seq), 0) AS value
                FROM palladium_changes
            )
            UPDATE palladium_changes
            SET append_seq = (
                SELECT base.value + numbered.ordinal
                FROM numbered CROSS JOIN base
                WHERE numbered.id = palladium_changes.id
            )
            WHERE append_seq IS NULL",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO atrium_append_sequence (id, next_seq)
             VALUES (1, COALESCE((SELECT MAX(append_seq) FROM palladium_changes), 0))",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_changes_append_seq
             ON palladium_changes (append_seq)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_changes_scope_append_seq
             ON palladium_changes (scope, append_seq)",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    /// Open an ephemeral, uniquely-named in-memory database (for tests).
    #[cfg(test)]
    pub async fn in_memory() -> Result<Self, AtriumError> {
        let id = Uuid::new_v4().simple();
        Self::open(&format!("sqlite:file:atrium-{id}?mode=memory&cache=shared")).await
    }

    pub async fn upsert_user(&self, user: &str) -> Result<(), AtriumError> {
        sqlx::query("INSERT OR IGNORE INTO app_users (user_id) VALUES (?)")
            .bind(user)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_workspace(&self, creator: &str) -> Result<String, AtriumError> {
        let id = Uuid::new_v4().to_string();
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO app_users (user_id) VALUES (?)")
            .bind(creator)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO workspaces (id, created_by, created_at) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(creator)
            .bind(now_millis())
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(creator)
            .bind(ROLE_OWNER)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn workspaces_for(&self, user: &str) -> Result<Vec<String>, AtriumError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY workspace_id",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn role_of(
        &self,
        workspace: &str,
        user: &str,
    ) -> Result<Option<String>, AtriumError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(workspace)
        .bind(user)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn require_member(&self, workspace: &str, user: &str) -> Result<String, AtriumError> {
        self.role_of(workspace, user)
            .await?
            .ok_or_else(|| AtriumError::Forbidden(format!("not a member of workspace {workspace}")))
    }

    pub async fn require_owner(&self, workspace: &str, user: &str) -> Result<(), AtriumError> {
        match self.role_of(workspace, user).await?.as_deref() {
            Some(ROLE_OWNER) => Ok(()),
            _ => Err(AtriumError::Forbidden(format!(
                "not the owner of workspace {workspace}"
            ))),
        }
    }

    pub async fn create_invite(
        &self,
        workspace: &str,
        creator: &str,
    ) -> Result<String, AtriumError> {
        let token = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO invites (token, workspace_id, created_by, accepted_by, created_at)
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

    pub async fn accept_invite(&self, token: &str, user: &str) -> Result<String, AtriumError> {
        let mut tx = self.pool.begin().await?;
        let workspace = sqlx::query_scalar::<_, String>(
            "UPDATE invites SET accepted_by = ?
             WHERE token = ? AND accepted_by IS NULL RETURNING workspace_id",
        )
        .bind(user)
        .bind(token)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AtriumError::NotFound("invite not found or already used".to_owned()))?;
        sqlx::query("INSERT OR IGNORE INTO app_users (user_id) VALUES (?)")
            .bind(user)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)",
        )
        .bind(&workspace)
        .bind(user)
        .bind(ROLE_MEMBER)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(workspace)
    }

    pub async fn members(&self, workspace: &str) -> Result<Vec<(String, String)>, AtriumError> {
        Ok(sqlx::query_as::<_, (String, String)>(
            "SELECT user_id, role FROM memberships WHERE workspace_id = ? ORDER BY user_id",
        )
        .bind(workspace)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn member_ids(&self, workspace: &str) -> Result<Vec<String>, AtriumError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT user_id FROM memberships WHERE workspace_id = ? ORDER BY user_id",
        )
        .bind(workspace)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn get_record(
        &self,
        workspace: &str,
        row_id: &str,
    ) -> Result<Option<AclRecord>, AtriumError> {
        let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, String)>(
            "SELECT row_id, workspace_id, table_name, root_id, owner_user_id, sharing
             FROM records WHERE workspace_id = ? AND row_id = ?",
        )
        .bind(workspace)
        .bind(row_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Self::record_from_row))
    }

    fn record_from_row(
        (row_id, workspace_id, table_name, root_id, owner_user_id, sharing): (
            String,
            String,
            String,
            Option<String>,
            String,
            String,
        ),
    ) -> AclRecord {
        AclRecord {
            row_id,
            workspace_id,
            table_name,
            root_id,
            owner_user_id,
            sharing,
        }
    }

    async fn get_record_in_tx(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        workspace: &str,
        row_id: &str,
    ) -> Result<Option<AclRecord>, AtriumError> {
        let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, String)>(
            "SELECT row_id, workspace_id, table_name, root_id, owner_user_id, sharing
             FROM records WHERE workspace_id = ? AND row_id = ?",
        )
        .bind(workspace)
        .bind(row_id)
        .fetch_optional(&mut **tx)
        .await?;
        Ok(row.map(Self::record_from_row))
    }

    pub async fn set_sharing(
        &self,
        workspace: &str,
        root_id: &str,
        sharing: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query("UPDATE records SET sharing = ? WHERE workspace_id = ? AND row_id = ? AND root_id IS NULL")
            .bind(sharing)
            .bind(workspace)
            .bind(root_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn add_share(
        &self,
        workspace: &str,
        root_id: &str,
        grantee: &str,
        perm: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "INSERT OR REPLACE INTO shares (workspace_id, root_id, grantee_user_id, perm)
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace)
        .bind(root_id)
        .bind(grantee)
        .bind(perm)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_share(
        &self,
        workspace: &str,
        root_id: &str,
        grantee: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "DELETE FROM shares WHERE workspace_id = ? AND root_id = ? AND grantee_user_id = ?",
        )
        .bind(workspace)
        .bind(root_id)
        .bind(grantee)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn enqueue_event(
        &self,
        workspace: &str,
        user: &str,
        root_id: &str,
        kind: &str,
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "INSERT INTO grant_events (workspace_id, user_id, root_id, kind) VALUES (?, ?, ?, ?)",
        )
        .bind(workspace)
        .bind(user)
        .bind(root_id)
        .bind(kind)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn grant_offer(
        &self,
        event_id: i64,
        through: i64,
        upper_bound: i64,
        complete: bool,
    ) -> Result<(), AtriumError> {
        sqlx::query(
            "UPDATE grant_events
             SET offered_through = ?, offered_upper_bound = ?, offered_complete = ?
             WHERE id = ?",
        )
        .bind(through)
        .bind(upper_bound)
        .bind(i32::from(complete))
        .bind(event_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn grant_offer_state(
        &self,
        workspace: &str,
        user: &str,
        event_id: i64,
    ) -> Result<Option<(String, Option<i64>, Option<i64>, Option<bool>, i64)>, AtriumError> {
        Ok(sqlx::query_as::<_, (String, Option<i64>, Option<i64>, Option<i64>, i64)>(
            "SELECT root_id, offered_through, offered_upper_bound, offered_complete, backfill_cursor
             FROM grant_events WHERE id = ? AND workspace_id = ? AND user_id = ? AND delivered = 0",
        )
        .bind(event_id)
        .bind(workspace)
        .bind(user)
        .fetch_optional(&self.pool)
        .await?
        .map(|(root, through, upper, complete, cursor)| {
            (root, through, upper, complete.map(|value| value != 0), cursor)
        }))
    }

    pub async fn workspace_append_bound(&self, workspace: &str) -> Result<i64, AtriumError> {
        Ok(sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MAX(append_seq) FROM palladium_changes WHERE scope = ?",
        )
        .bind(workspace)
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0))
    }

    pub async fn list_changes_through(
        &self,
        workspace: &str,
        after: i64,
        through: i64,
        limit: Option<u32>,
    ) -> Result<Vec<SequencedChange>, AtriumError> {
        let mut query = sqlx::QueryBuilder::new(
            "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json, append_seq
             FROM palladium_changes WHERE scope = ",
        );
        query.push_bind(workspace);
        query.push(" AND append_seq > ").push_bind(after);
        query.push(" AND append_seq <= ").push_bind(through);
        query.push(" ORDER BY append_seq");
        if let Some(limit) = limit {
            query.push(" LIMIT ").push_bind(i64::from(limit));
        }
        let rows: Vec<(String, i64, i64, String, String, i64)> =
            query.build_query_as().fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|(id, millis, counter, node_id, ops_json, append_seq)| {
                let id = Uuid::parse_str(&id).map_err(AtriumError::internal)?;
                let hlc = Hlc::from_db_parts(millis, counter, &node_id)
                    .map_err(AtriumError::BadRequest)?;
                let ops: Vec<Op> =
                    serde_json::from_str(&ops_json).map_err(AtriumError::internal)?;
                Ok(SequencedChange {
                    append_seq,
                    change: Change { id, hlc, ops },
                })
            })
            .collect()
    }

    pub async fn acknowledge_grant(
        &self,
        workspace: &str,
        user: &str,
        event_id: i64,
    ) -> Result<bool, AtriumError> {
        let mut tx = self.pool.begin().await?;
        let state = sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<i64>)>(
            "SELECT offered_through, offered_upper_bound, offered_complete
             FROM grant_events WHERE id = ? AND workspace_id = ? AND user_id = ? AND delivered = 0",
        )
        .bind(event_id)
        .bind(workspace)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((through, upper, complete)) = state else {
            return Ok(false);
        };
        let Some(through) = through else {
            return Ok(true);
        };
        let complete = complete == Some(1) || upper.is_some_and(|bound| through >= bound);
        sqlx::query(
            "UPDATE grant_events
             SET backfill_cursor = ?,
                 offered_through = NULL,
                 offered_upper_bound = CASE WHEN ? != 0 THEN NULL ELSE offered_upper_bound END,
                 offered_complete = NULL,
                 delivered = ?
             WHERE id = ? AND workspace_id = ? AND user_id = ? AND delivered = 0",
        )
        .bind(through)
        .bind(i32::from(complete))
        .bind(i32::from(complete))
        .bind(event_id)
        .bind(workspace)
        .bind(user)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn pending_events(
        &self,
        workspace: &str,
        user: &str,
    ) -> Result<Vec<PendingEvent>, AtriumError> {
        Ok(sqlx::query_as::<_, (i64, String, String)>(
            "SELECT id, kind, root_id FROM grant_events
             WHERE workspace_id = ? AND user_id = ? AND delivered = 0 ORDER BY id",
        )
        .bind(workspace)
        .bind(user)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(id, kind, root_id)| PendingEvent { id, kind, root_id })
        .collect())
    }

    /// Acknowledge events for this caller/workspace, advancing grant progress.
    pub async fn acknowledge_events(
        &self,
        workspace: &str,
        user: &str,
        event_ids: &[i64],
    ) -> Result<(), AtriumError> {
        let mut ids = event_ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        if ids.is_empty() {
            return Ok(());
        }
        let mut lookup =
            sqlx::QueryBuilder::new("SELECT id, kind FROM grant_events WHERE workspace_id = ");
        lookup.push_bind(workspace);
        lookup.push(" AND user_id = ").push_bind(user);
        lookup.push(" AND id IN (");
        let mut separated = lookup.separated(", ");
        for id in &ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        let owned: Vec<(i64, String)> = lookup.build_query_as().fetch_all(&self.pool).await?;
        if owned.len() != ids.len() {
            return Err(AtriumError::Forbidden(
                "event acknowledgement includes an event outside this caller or workspace"
                    .to_owned(),
            ));
        }
        for (id, kind) in owned {
            if kind == EVENT_GRANT {
                self.acknowledge_grant(workspace, user, id).await?;
            } else {
                sqlx::query(
                    "UPDATE grant_events SET delivered = 1
                     WHERE id = ? AND workspace_id = ? AND user_id = ?",
                )
                .bind(id)
                .bind(workspace)
                .bind(user)
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }

    pub async fn effective_root(
        &self,
        workspace: &str,
        row_id: &str,
    ) -> Result<Option<AclRecord>, AtriumError> {
        let Some(record) = self.get_record(workspace, row_id).await? else {
            return Ok(None);
        };
        match record.root_id.as_deref() {
            Some(root_id) => self.get_record(workspace, root_id).await,
            None => Ok(Some(record)),
        }
    }

    pub async fn can_read(
        &self,
        workspace: &str,
        caller: &str,
        row_id: &str,
    ) -> Result<bool, AtriumError> {
        let Some(root) = self.effective_root(workspace, row_id).await? else {
            return Ok(false);
        };
        if caller == root.owner_user_id
            || root.sharing == SHARING_HOUSEHOLD_READ
            || root.sharing == SHARING_HOUSEHOLD_RW
        {
            return Ok(true);
        }
        let has_share = sqlx::query_scalar::<_, i64>(
            "SELECT 1 FROM shares WHERE workspace_id = ? AND root_id = ? AND grantee_user_id = ?",
        )
        .bind(workspace)
        .bind(&root.row_id)
        .bind(caller)
        .fetch_optional(&self.pool)
        .await?
        .is_some();
        Ok(has_share)
    }

    pub async fn can_write(
        &self,
        workspace: &str,
        caller: &str,
        row_id: &str,
    ) -> Result<bool, AtriumError> {
        let Some(root) = self.effective_root(workspace, row_id).await? else {
            return Ok(false);
        };
        if caller == root.owner_user_id || root.sharing == SHARING_HOUSEHOLD_RW {
            return Ok(true);
        }
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT perm FROM shares WHERE workspace_id = ? AND root_id = ? AND grantee_user_id = ?",
        )
        .bind(workspace)
        .bind(&root.row_id)
        .bind(caller)
        .fetch_optional(&self.pool)
        .await?
        .as_deref()
            == Some(PERM_WRITE))
    }

    async fn can_write_in_tx(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        workspace: &str,
        caller: &str,
        row_id: &str,
    ) -> Result<Option<AclRecord>, AtriumError> {
        let Some(record) = Self::get_record_in_tx(tx, workspace, row_id).await? else {
            return Ok(None);
        };
        let root = match record.root_id.as_deref() {
            Some(root_id) => Self::get_record_in_tx(tx, workspace, root_id).await?,
            None => Some(record),
        };
        let Some(root) = root else {
            return Ok(None);
        };
        if caller == root.owner_user_id || root.sharing == SHARING_HOUSEHOLD_RW {
            return Ok(Some(root));
        }
        let perm = sqlx::query_scalar::<_, String>(
            "SELECT perm FROM shares WHERE workspace_id = ? AND root_id = ? AND grantee_user_id = ?",
        )
        .bind(workspace)
        .bind(&root.row_id)
        .bind(caller)
        .fetch_optional(&mut **tx)
        .await?;
        if perm.as_deref() == Some(PERM_WRITE) {
            Ok(Some(root))
        } else {
            Ok(None)
        }
    }

    /// Authorize ACL metadata and append the change in one `SQLite` transaction.
    /// The route has already checked workspace membership before this method runs.
    pub async fn authorize_and_append_change(
        &self,
        workspace: &str,
        caller: &str,
        change: &Change,
    ) -> Result<AppendOutcome, AtriumError> {
        palladium_core::validate_change(
            change,
            now_millis().try_into().unwrap_or(u64::MAX),
            300_000,
        )
        .map_err(AtriumError::BadRequest)?;
        let canonical = serde_json::to_vec(change).map_err(AtriumError::internal)?;
        let content_hash = format!("{:x}", Sha256::digest(canonical));
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let change_id = change.id.to_string();
        if let Some((existing, append_seq)) = sqlx::query_as::<_, (String, i64)>(
            "SELECT content_hash, append_seq FROM palladium_changes WHERE scope = ? AND id = ?",
        )
        .bind(workspace)
        .bind(&change_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if existing == content_hash {
                tx.commit().await?;
                return Ok(AppendOutcome::Duplicate(append_seq));
            }
            return Err(AtriumError::Conflict("change_conflict".to_owned()));
        }
        let now = now_millis();
        let wall = i64::try_from(change.hlc.millis())
            .map_err(|_| AtriumError::BadRequest("invalid_hlc".to_owned()))?;
        if wall > now.saturating_add(300_000) {
            return Err(AtriumError::Conflict("clock_skew".to_owned()));
        }
        let node_id = change.hlc.node_id().to_string();
        if let Some((last_millis, last_counter)) = sqlx::query_as::<_, (i64, i64)>(
            "SELECT hlc_millis, hlc_counter FROM palladium_changes
             WHERE scope = ? AND hlc_node_id = ?
             ORDER BY hlc_millis DESC, hlc_counter DESC LIMIT 1",
        )
        .bind(workspace)
        .bind(&node_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if (wall, i64::from(change.hlc.counter())) <= (last_millis, last_counter) {
                return Err(AtriumError::Conflict("clock_skew".to_owned()));
            }
        }
        sqlx::query(
            "INSERT OR IGNORE INTO member_nodes (workspace_id, user_id, node_id)
             VALUES (?, ?, ?)",
        )
        .bind(workspace)
        .bind(caller)
        .bind(&node_id)
        .execute(&mut *tx)
        .await?;
        let node_owner = sqlx::query_scalar::<_, String>(
            "SELECT user_id FROM member_nodes WHERE workspace_id = ? AND node_id = ?",
        )
        .bind(workspace)
        .bind(&node_id)
        .fetch_one(&mut *tx)
        .await?;
        if node_owner != caller {
            return Err(AtriumError::Forbidden(
                "hlc node is registered to another workspace member".to_owned(),
            ));
        }
        let mut change_root: Option<String> = None;
        for op in &change.ops {
            let table = op.table();
            let role = registry::role_of(table)
                .ok_or_else(|| AtriumError::BadRequest(format!("unknown table {table}")))?;
            let row_id = op.row_id().to_string();
            let op_root = match role {
                TableRole::Root(_) if matches!(op, Op::Insert { .. }) => row_id.clone(),
                TableRole::Child if matches!(op, Op::Insert { .. }) => {
                    let Op::Insert { data, .. } = op else {
                        return Err(AtriumError::BadRequest("expected child insert".to_owned()));
                    };
                    data.get("root_id")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| {
                            AtriumError::BadRequest("child row missing root_id".to_owned())
                        })?
                        .to_owned()
                }
                _ => Self::get_record_in_tx(&mut tx, workspace, &row_id)
                    .await?
                    .map(|record| record.root_id.unwrap_or(record.row_id))
                    .ok_or_else(|| AtriumError::Forbidden(format!("unknown row {row_id}")))?,
            };
            if let Some(existing_root) = &change_root {
                if existing_root != &op_root {
                    return Err(AtriumError::BadRequest(
                        "a change must target one aggregate root".to_owned(),
                    ));
                }
            } else {
                change_root = Some(op_root);
            }
            match role {
                TableRole::Root(_) if matches!(op, Op::Insert { .. }) => {
                    match Self::get_record_in_tx(&mut tx, workspace, &row_id).await? {
                        Some(record)
                            if record.root_id.is_some() || record.owner_user_id != caller =>
                        {
                            return Err(AtriumError::Forbidden(
                                "cannot write a record owned by another user".to_owned(),
                            ));
                        }
                        Some(_) => {}
                        None => {
                            sqlx::query(
                                "INSERT INTO records
                                 (workspace_id, row_id, table_name, root_id, owner_user_id, sharing)
                                 VALUES (?, ?, ?, NULL, ?, ?)",
                            )
                            .bind(workspace)
                            .bind(&row_id)
                            .bind(table)
                            .bind(caller)
                            .bind(SHARING_PRIVATE)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }
                }
                TableRole::Child if matches!(op, Op::Insert { .. }) => {
                    let Op::Insert { data, .. } = op else {
                        return Err(AtriumError::BadRequest(
                            "child insert authorization received a non-insert operation".to_owned(),
                        ));
                    };
                    let root_id = data
                        .get("root_id")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| {
                            AtriumError::BadRequest("child row missing root_id".to_owned())
                        })?;
                    let root = Self::can_write_in_tx(&mut tx, workspace, caller, root_id)
                        .await?
                        .ok_or_else(|| {
                            AtriumError::Forbidden(format!("no write access to root {root_id}"))
                        })?;
                    if root.root_id.is_some() {
                        return Err(AtriumError::BadRequest(
                            "child root_id must name a root record".to_owned(),
                        ));
                    }
                    match Self::get_record_in_tx(&mut tx, workspace, &row_id).await? {
                        Some(record)
                            if record.root_id.as_deref() != Some(root_id)
                                || record.owner_user_id != root.owner_user_id =>
                        {
                            return Err(AtriumError::Forbidden(
                                "child record belongs to another root or owner".to_owned(),
                            ));
                        }
                        Some(_) => {}
                        None => {
                            sqlx::query(
                                "INSERT INTO records
                                 (workspace_id, row_id, table_name, root_id, owner_user_id, sharing)
                                 VALUES (?, ?, ?, ?, ?, ?)",
                            )
                            .bind(workspace)
                            .bind(&row_id)
                            .bind(table)
                            .bind(root_id)
                            .bind(&root.owner_user_id)
                            .bind(SHARING_PRIVATE)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }
                }
                TableRole::Root(_) | TableRole::Child => {
                    if Self::can_write_in_tx(&mut tx, workspace, caller, &row_id)
                        .await?
                        .is_none()
                    {
                        return Err(AtriumError::Forbidden(format!(
                            "no write access to {row_id}"
                        )));
                    }
                }
            }
        }
        let hlc_millis = i64::try_from(change.hlc.millis()).map_err(|_| {
            AtriumError::BadRequest(format!(
                "hlc_millis {} overflows SQLite integer",
                change.hlc.millis()
            ))
        })?;
        let ops_json = serde_json::to_string(&change.ops).map_err(AtriumError::internal)?;
        let append_seq = sqlx::query_scalar::<_, i64>(
            "UPDATE atrium_append_sequence
             SET next_seq = next_seq + 1
             WHERE id = 1
             RETURNING next_seq",
        )
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO palladium_changes
             (id, scope, append_cursor, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json, append_seq, content_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(change_id)
        .bind(workspace)
        .bind(append_seq)
        .bind(change.hlc.sort_key())
        .bind(hlc_millis)
        .bind(i64::from(change.hlc.counter()))
        .bind(change.hlc.node_id().to_string())
        .bind(ops_json)
        .bind(append_seq)
        .bind(content_hash)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(AppendOutcome::Inserted(append_seq))
    }

    pub async fn list_changes(
        &self,
        workspace: &str,
        after: i64,
        limit: Option<u32>,
    ) -> Result<Vec<SequencedChange>, AtriumError> {
        let mut query = sqlx::QueryBuilder::new(
            "SELECT id, hlc_millis, hlc_counter, hlc_node_id, ops_json, append_seq
             FROM palladium_changes WHERE scope = ",
        );
        query.push_bind(workspace);
        query.push(" AND append_seq > ").push_bind(after);
        query.push(" ORDER BY append_seq");
        if let Some(limit) = limit {
            query.push(" LIMIT ").push_bind(i64::from(limit));
        }
        let rows: Vec<(String, i64, i64, String, String, i64)> =
            query.build_query_as().fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|(id, millis, counter, node_id, ops_json, append_seq)| {
                let id = Uuid::parse_str(&id).map_err(AtriumError::internal)?;
                let hlc = Hlc::from_db_parts(millis, counter, &node_id)
                    .map_err(AtriumError::BadRequest)?;
                let ops: Vec<Op> =
                    serde_json::from_str(&ops_json).map_err(AtriumError::internal)?;
                Ok(SequencedChange {
                    append_seq,
                    change: Change { id, hlc, ops },
                })
            })
            .collect()
    }
    pub async fn put_blob(
        &self,
        blob_id: &str,
        workspace: &str,
        note_id: &str,
        owner: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<(), AtriumError> {
        if bytes.len() > MAX_BLOB_BYTES {
            return Err(AtriumError::BadRequest(format!(
                "blob exceeds maximum size of {MAX_BLOB_BYTES} bytes"
            )));
        }
        if let Some(existing) = self.get_blob(blob_id).await? {
            if existing.workspace_id != workspace
                || existing.note_id != note_id
                || existing.owner_user_id != owner
                || existing.content_type != content_type
                || existing.bytes != bytes
            {
                return Err(AtriumError::Conflict(
                    "blob id is already bound to different content".to_owned(),
                ));
            }
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO blobs
             (blob_id, workspace_id, note_id, owner_user_id, content_type, bytes, created_at)
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
    pub async fn get_blob(&self, blob_id: &str) -> Result<Option<BlobRecord>, AtriumError> {
        let row = sqlx::query_as::<_, (String, String, String, String, String, Vec<u8>)>(
            "SELECT blob_id, workspace_id, note_id, owner_user_id, content_type, bytes
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
    use palladium_core::{Change, Hlc, NodeId, Op};
    use serde_json::json;
    use uuid::Uuid;

    use super::{AtriumDb, ROLE_MEMBER, ROLE_OWNER};

    fn root_change(id: Uuid, row_id: Uuid, millis: u64) -> Change {
        Change {
            id,
            hlc: Hlc::new(NodeId::from_uuid(id), millis),
            ops: vec![Op::Insert {
                table: "lists".to_owned(),
                row_id,
                data: json!({ "id": row_id }),
            }],
        }
    }

    #[tokio::test]
    async fn append_sequence_orders_late_old_hlc_and_duplicate_once() {
        let db = AtriumDb::in_memory().await.unwrap();
        let workspace = db.create_workspace("alice").await.unwrap();
        let first = root_change(Uuid::now_v7(), Uuid::now_v7(), 2_000);
        let late = root_change(Uuid::now_v7(), Uuid::now_v7(), 1_000);
        db.authorize_and_append_change(&workspace, "alice", &first)
            .await
            .unwrap();
        db.authorize_and_append_change(&workspace, "alice", &late)
            .await
            .unwrap();
        let (left, right) = tokio::join!(
            db.authorize_and_append_change(&workspace, "alice", &late),
            db.authorize_and_append_change(&workspace, "alice", &late)
        );
        left.unwrap();
        right.unwrap();
        let history = db.list_changes(&workspace, 0, None).await.unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].change.id, first.id);
        assert_eq!(history[1].change.id, late.id);
        assert_eq!(history[1].append_seq, 2);
    }
    #[tokio::test]
    async fn scoped_duplicate_payload_conflict_has_no_second_append() {
        let db = AtriumDb::in_memory().await.unwrap();
        let first_scope = db.create_workspace("alice").await.unwrap();
        let second_scope = db.create_workspace("bob").await.unwrap();
        let id = Uuid::now_v7();
        let first = root_change(id, Uuid::now_v7(), 2_000);
        db.authorize_and_append_change(&first_scope, "alice", &first)
            .await
            .unwrap();
        let divergent = root_change(id, Uuid::now_v7(), 2_001);
        assert!(matches!(
            db.authorize_and_append_change(&first_scope, "alice", &divergent)
                .await,
            Err(super::AtriumError::Conflict(_))
        ));
        db.authorize_and_append_change(&second_scope, "bob", &first)
            .await
            .unwrap();
        assert_eq!(
            db.list_changes(&first_scope, 0, None).await.unwrap().len(),
            1
        );
        assert_eq!(
            db.list_changes(&second_scope, 0, None).await.unwrap().len(),
            1
        );
    }

    #[tokio::test]
    async fn legacy_change_history_rebuilds_scoped_primary_key_and_hashes(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("atrium-legacy-{}.sqlite", Uuid::new_v4()));
        std::fs::File::create(&path)?;
        let url = format!("sqlite:{}", path.display());
        let pool = sqlx::SqlitePool::connect(&url).await?;
        sqlx::query(
            "CREATE TABLE palladium_changes (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                append_cursor INTEGER NOT NULL UNIQUE,
                hlc_key TEXT NOT NULL,
                hlc_millis INTEGER NOT NULL,
                hlc_counter INTEGER NOT NULL,
                hlc_node_id TEXT NOT NULL,
                ops_json TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await?;
        let id = Uuid::now_v7().to_string();
        let node_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO palladium_changes
             (id, scope, append_cursor, hlc_key, hlc_millis, hlc_counter, hlc_node_id, ops_json)
             VALUES (?, 'legacy', 1, 'legacy', 1, 0, ?, '[]')",
        )
        .bind(&id)
        .bind(node_id)
        .execute(&pool)
        .await?;
        pool.close().await;

        let db = AtriumDb::open(&url).await?;
        let primary_key: Vec<(String, i64)> = sqlx::query_as(
            "SELECT name, pk FROM pragma_table_info('palladium_changes') WHERE pk > 0 ORDER BY pk",
        )
        .fetch_all(&db.pool)
        .await?;
        assert_eq!(
            primary_key
                .into_iter()
                .map(|(name, _)| name)
                .collect::<Vec<_>>(),
            vec!["scope", "id"]
        );
        let indexes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master
             WHERE type = 'index'
               AND name IN ('idx_changes_append_seq', 'idx_changes_scope_append_seq')
             ORDER BY name",
        )
        .fetch_all(&db.pool)
        .await?;
        assert_eq!(
            indexes,
            vec!["idx_changes_append_seq", "idx_changes_scope_append_seq"]
        );
        let hash: String = sqlx::query_scalar(
            "SELECT content_hash FROM palladium_changes WHERE scope = 'legacy' AND id = ?",
        )
        .bind(&id)
        .fetch_one(&db.pool)
        .await?;
        assert_eq!(hash.len(), 64);
        db.pool.close().await;
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[tokio::test]
    async fn create_workspace_makes_creator_owner() {
        let db = AtriumDb::in_memory().await.unwrap();
        let ws = db.create_workspace("alice").await.unwrap();
        assert_eq!(
            db.role_of(&ws, "alice").await.unwrap().as_deref(),
            Some(ROLE_OWNER)
        );
        assert_eq!(db.workspaces_for("alice").await.unwrap(), vec![ws]);
    }

    #[tokio::test]
    async fn invite_and_accept_adds_member() {
        let db = AtriumDb::in_memory().await.unwrap();
        let ws = db.create_workspace("alice").await.unwrap();
        let token = db.create_invite(&ws, "alice").await.unwrap();
        let joined = db.accept_invite(&token, "bob").await.unwrap();
        assert_eq!(joined, ws);
        assert_eq!(
            db.role_of(&ws, "bob").await.unwrap().as_deref(),
            Some(ROLE_MEMBER)
        );
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

    #[tokio::test]
    async fn blob_retries_are_idempotent_and_conflicts_rejected() {
        let db = AtriumDb::in_memory().await.unwrap();
        db.put_blob("blob", "workspace", "note", "owner", "image/png", b"bytes")
            .await
            .unwrap();
        db.put_blob("blob", "workspace", "note", "owner", "image/png", b"bytes")
            .await
            .unwrap();
        assert!(db
            .put_blob("blob", "workspace", "note", "owner", "image/jpeg", b"bytes")
            .await
            .is_err());
    }
}
