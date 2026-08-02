//! Change proxy — workspace-scoped `/v1/changes`, forwarded to Palladium.
//!
//! Phase 3a enforces **workspace isolation** only (the caller must be a member
//! of the target workspace). Phase 3b layers record-level ACL filtering on top.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use palladium_core::{Change, ChangeStore, Hlc, Scope};
use serde::Deserialize;

use crate::{error::AtriumError, identity::Caller, state::AtriumState};

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

/// `POST /v1/changes` — persist a change in the caller's workspace.
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller is not a member of the workspace;
/// [`AtriumError::BadRequest`] if the workspace header is missing.
pub(super) async fn post_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<StatusCode, AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    state
        .changes()
        .insert(&Scope::new(workspace.as_str()), &change)
        .await
        .map_err(AtriumError::internal)?;
    Ok(StatusCode::CREATED)
}

/// `GET /v1/changes` — list the caller's workspace changes after a cursor.
///
/// # Errors
/// [`AtriumError::Forbidden`] if not a member; [`AtriumError::BadRequest`] on a
/// missing workspace header or an invalid cursor.
pub(super) async fn get_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Query(params): Query<ListQuery>,
) -> Result<Json<Vec<Change>>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    let after = params
        .after
        .as_deref()
        .map(str::parse::<Hlc>)
        .transpose()
        .map_err(AtriumError::BadRequest)?;
    let changes = state
        .changes()
        .list_after(&Scope::new(workspace.as_str()), after, params.limit)
        .await
        .map_err(AtriumError::internal)?;
    Ok(Json(changes))
}
