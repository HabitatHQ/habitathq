//! Change proxy with record-level ACL (Phase 3b).
//!
//! - **Write** (`POST`): each op is authorized against the caller's effective
//!   ACL; the owner is set from the identity (never the payload, `D17`);
//!   root/child ownership is recorded. An unauthorized op rejects the change.
//! - **Read** (`GET`): the workspace change stream is filtered to what the
//!   caller may see, plus **grant-backfill** (granted roots' full history) and
//!   **revoke-purge** (roots to delete locally), returned as `{changes, purges}`.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use palladium_core::{Change, ChangeStore, Hlc, Op, Scope};
use serde::{Deserialize, Serialize};

use crate::{
    db::{AtriumDb, EVENT_GRANT, EVENT_REVOKE},
    error::AtriumError,
    identity::Caller,
    registry::{self, TableRole},
    state::AtriumState,
};

/// Header naming the target workspace (Atrium derives the opaque store scope
/// from it after authorizing membership — clients never pass the raw scope).
const WORKSPACE_HEADER: &str = "x-workspace";

/// Read and validate the `X-Workspace` header.
fn workspace_of(headers: &HeaderMap) -> Result<String, AtriumError> {
    headers
        .get(WORKSPACE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AtriumError::BadRequest(format!("missing {WORKSPACE_HEADER} header")))
}

/// Query parameters for `GET /v1/changes`.
#[derive(Debug, Deserialize)]
pub(super) struct ListQuery {
    /// Return changes strictly after this HLC sort-key cursor.
    after: Option<String>,
    /// Cap the number of changes returned.
    limit: Option<u32>,
}

/// Envelope returned by `GET /v1/changes`: visible changes plus roots to purge.
#[derive(Debug, Serialize)]
pub(super) struct ChangesResponse {
    /// Changes the caller may see (after-cursor + grant backfill).
    changes: Vec<Change>,
    /// Root ids the caller lost access to; the client purges them locally.
    purges: Vec<String>,
}

/// Record ownership for an op and authorize the caller to write it.
///
/// The owner is always the authenticated caller (`D17`); a root's `row_id`
/// existing under a different owner is rejected as forgery. Children resolve
/// their write permission through their root.
async fn authorize_and_record(
    db: &AtriumDb,
    workspace: &str,
    caller: &str,
    op: &Op,
) -> Result<(), AtriumError> {
    let table = op.table();
    let role = registry::role_of(table)
        .ok_or_else(|| AtriumError::BadRequest(format!("unknown table {table}")))?;
    let row_id = op.row_id().to_string();

    match role {
        TableRole::Root(_) => {
            if matches!(op, Op::Insert { .. }) {
                if let Some(existing) = db.get_record(&row_id).await? {
                    if existing.owner_user_id != caller {
                        return Err(AtriumError::Forbidden(
                            "cannot write a record owned by another user".to_owned(),
                        ));
                    }
                } else {
                    db.insert_record(&row_id, workspace, table, None, caller).await?;
                }
            } else if !db.can_write(caller, &row_id).await? {
                return Err(AtriumError::Forbidden(format!("no write access to {row_id}")));
            }
        }
        TableRole::Child => {
            if let Op::Insert { data, .. } = op {
                let root_id = data
                    .get("root_id")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| AtriumError::BadRequest("child row missing root_id".to_owned()))?;
                if !db.can_write(caller, root_id).await? {
                    return Err(AtriumError::Forbidden(format!(
                        "no write access to root {root_id}"
                    )));
                }
                db.insert_record(&row_id, workspace, table, Some(root_id), caller).await?;
            } else if !db.can_write(caller, &row_id).await? {
                return Err(AtriumError::Forbidden(format!("no write access to {row_id}")));
            }
        }
    }
    Ok(())
}

/// The effective-root id of a change (from its first op), if known.
async fn change_root(db: &AtriumDb, change: &Change) -> Result<Option<String>, AtriumError> {
    let Some(first) = change.ops.first() else {
        return Ok(None);
    };
    Ok(db
        .effective_root(&first.row_id().to_string())
        .await?
        .map(|r| r.row_id))
}

/// Whether the caller may read a change (via its first op's effective root).
async fn change_visible(db: &AtriumDb, caller: &str, change: &Change) -> Result<bool, AtriumError> {
    let Some(first) = change.ops.first() else {
        return Ok(false);
    };
    db.can_read(caller, &first.row_id().to_string()).await
}

/// `POST /v1/changes` — authorize every op, then persist the change.
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller lacks write access to any row;
/// [`AtriumError::BadRequest`] on a missing workspace header / unknown table.
pub(super) async fn post_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<StatusCode, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    for op in &change.ops {
        authorize_and_record(db, &workspace, user.as_str(), op).await?;
    }
    state
        .changes()
        .insert(&Scope::new(workspace.as_str()), &change)
        .await
        .map_err(AtriumError::internal)?;
    Ok(StatusCode::CREATED)
}

/// `GET /v1/changes` — ACL-filtered stream + grant-backfill + revoke-purge.
///
/// # Errors
/// [`AtriumError::Forbidden`] if not a member; [`AtriumError::BadRequest`] on a
/// missing workspace header or invalid cursor.
pub(super) async fn get_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Query(params): Query<ListQuery>,
) -> Result<Json<ChangesResponse>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    let scope = Scope::new(workspace.as_str());
    let after = params
        .after
        .as_deref()
        .map(str::parse::<Hlc>)
        .transpose()
        .map_err(AtriumError::BadRequest)?;

    // Visible after-cursor changes.
    let stream = state
        .changes()
        .list_after(&scope, after, params.limit)
        .await
        .map_err(AtriumError::internal)?;
    let mut changes = Vec::new();
    for change in stream {
        if change_visible(db, user.as_str(), &change).await? {
            changes.push(change);
        }
    }

    // Grant-backfill: surface each newly-granted root's full history, out of
    // cursor order, so the caller converges to the shared state.
    let grants = db.pending_events(user.as_str(), EVENT_GRANT).await?;
    if !grants.is_empty() {
        let history = state
            .changes()
            .list_after(&scope, None, None)
            .await
            .map_err(AtriumError::internal)?;
        for change in history {
            if changes.iter().any(|c| c.id == change.id) {
                continue;
            }
            if let Some(root) = change_root(db, &change).await? {
                if grants.iter().any(|(_, granted)| *granted == root) {
                    changes.push(change);
                }
            }
        }
        let ids: Vec<i64> = grants.iter().map(|(id, _)| *id).collect();
        db.mark_delivered(&ids).await?;
    }

    // Revoke-purge: roots the caller lost access to.
    let revokes = db.pending_events(user.as_str(), EVENT_REVOKE).await?;
    let mut purges: Vec<String> = revokes.iter().map(|(_, root)| root.clone()).collect();
    purges.sort();
    purges.dedup();
    if !revokes.is_empty() {
        let ids: Vec<i64> = revokes.iter().map(|(id, _)| *id).collect();
        db.mark_delivered(&ids).await?;
    }

    Ok(Json(ChangesResponse { changes, purges }))
}
