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
";

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

    /// Access the underlying pool (Phase 3b extends the schema on it).
    #[must_use]
    pub const fn pool(&self) -> &SqlitePool {
        &self.pool
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
