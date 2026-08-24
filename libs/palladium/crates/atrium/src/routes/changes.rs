//! Workspace-scoped change proxy with record-level ACL.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use palladium_core::Change;
use serde::{Deserialize, Serialize};

use crate::{
    db::{AtriumDb, PendingEvent, EVENT_GRANT, EVENT_REVOKE},
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
    after: Option<i64>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AckRequest {
    pub event_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub(super) struct WireChange {
    #[serde(flatten)]
    change: Change,
    cursor: String,
}

#[derive(Debug, Serialize)]
pub(super) struct ChangesResponse {
    changes: Vec<WireChange>,
    purges: Vec<String>,
    events: Vec<PendingEvent>,
    cursor: Option<String>,
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
    let after = params.after;
    let history = db.list_changes(&workspace, after, params.limit).await?;
    let cursor = history
        .last()
        .map(|(cursor, _)| cursor.to_string())
        .or_else(|| after.map(|cursor| cursor.to_string()));
    let mut changes = Vec::new();
    for (append_cursor, change) in history {
        if change_visible(db, &workspace, user.as_str(), &change).await? {
            changes.push(WireChange {
                change,
                cursor: append_cursor.to_string(),
            });
        }
    }
    let events = db.pending_events(&workspace, user.as_str()).await?;
    let grants: Vec<&PendingEvent> = events
        .iter()
        .filter(|event| event.kind == EVENT_GRANT)
        .collect();
    if !grants.is_empty() {
        for (append_cursor, change) in db.list_changes(&workspace, None, None).await? {
            if changes
                .iter()
                .any(|existing| existing.change.id == change.id)
            {
                continue;
            }
            if let Some(root) = change_root(db, &workspace, &change).await? {
                if grants.iter().any(|event| event.root_id == root) {
                    changes.push(WireChange {
                        change,
                        cursor: append_cursor.to_string(),
                    });
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
        purges,
        events,
        cursor,
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
