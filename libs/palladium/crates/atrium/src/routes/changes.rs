//! Workspace-scoped change proxy with record-level ACL.

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
};
use palladium_core::Change;
use serde::{Deserialize, Serialize};

use crate::{
    db::{AtriumDb, EVENT_GRANT, EVENT_REVOKE, PendingEvent},
    error::AtriumError,
    identity::Caller,
    state::AtriumState,
};

const WORKSPACE_HEADER: &str = "x-workspace";

fn workspace_of(headers: &HeaderMap) -> Result<String, AtriumError> {
    headers
        .get(WORKSPACE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AtriumError::BadRequest(format!("missing {WORKSPACE_HEADER} header")))
}

#[derive(Debug, Deserialize)]
pub(super) struct ListQuery {
    after: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AckRequest {
    pub event_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub(super) struct ChangesResponse {
    changes: Vec<Change>,
    cursor: String,
    purges: Vec<String>,
    events: Vec<PendingEvent>,
}

async fn change_root(
    db: &AtriumDb,
    workspace: &str,
    change: &Change,
) -> Result<Option<String>, AtriumError> {
    let Some(first) = change.ops.first() else {
        return Ok(None);
    };
    Ok(db
        .effective_root(workspace, &first.row_id().to_string())
        .await?
        .map(|root| root.row_id))
}

async fn change_visible(
    db: &AtriumDb,
    workspace: &str,
    caller: &str,
    change: &Change,
) -> Result<bool, AtriumError> {
    if change.ops.is_empty() {
        return Ok(false);
    }
    for op in &change.ops {
        if !db
            .can_read(workspace, caller, &op.row_id().to_string())
            .await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn post_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<StatusCode, AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    state
        .db()
        .authorize_and_append_change(&workspace, user.as_str(), &change)
        .await?;
    Ok(StatusCode::CREATED)
}

pub(super) async fn get_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Query(params): Query<ListQuery>,
) -> Result<Json<ChangesResponse>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;

    let after = match params.after.as_deref() {
        None => 0,
        Some(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value
                .parse::<i64>()
                .map_err(|err| AtriumError::BadRequest(err.to_string()))?
        }
        Some(_) => {
            return Err(AtriumError::BadRequest(
                "after must be a non-negative decimal sequence".to_owned(),
            ));
        }
    };
    let history = db.list_changes(&workspace, after, params.limit).await?;
    let cursor = history
        .last()
        .map_or(after, |entry| entry.append_seq)
        .to_string();
    let mut changes = Vec::new();
    for entry in history {
        let change = entry.change;
        if change_visible(db, &workspace, user.as_str(), &change).await? {
            changes.push(change);
        }
    }
    let events = db.pending_events(&workspace, user.as_str()).await?;
    let grants: Vec<&PendingEvent> = events
        .iter()
        .filter(|event| event.kind == EVENT_GRANT)
        .collect();
    if !grants.is_empty() {
        for entry in db.list_changes(&workspace, 0, None).await? {
            let change = entry.change;
            if changes.iter().any(|existing| existing.id == change.id) {
                continue;
            }
            if let Some(root) = change_root(db, &workspace, &change).await? {
                if grants.iter().any(|event| event.root_id == root) {
                    changes.push(change);
                }
            }
        }
    }
    let mut purges: Vec<String> = events
        .iter()
        .filter(|event| event.kind == EVENT_REVOKE)
        .map(|event| event.root_id.clone())
        .collect();
    purges.sort();
    purges.dedup();
    Ok(Json(ChangesResponse {
        changes,
        cursor,
        purges,
        events,
    }))
}

/// Acknowledge pending event ids for the authenticated caller and workspace.
pub(super) async fn acknowledge_events(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(req): Json<AckRequest>,
) -> Result<StatusCode, AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    state
        .db()
        .acknowledge_events(&workspace, user.as_str(), &req.event_ids)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
