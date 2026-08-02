//! Tenancy endpoints: workspaces, invites, membership.

use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};

use crate::{error::AtriumError, identity::Caller, state::AtriumState};

/// `POST /v1/workspaces` — create a workspace; the caller becomes its owner.
///
/// # Errors
/// Returns an error if the write fails.
pub(super) async fn create_workspace(
    State(state): State<AtriumState>,
    Caller(user): Caller,
) -> Result<Json<Value>, AtriumError> {
    let id = state.db().create_workspace(user.as_str()).await?;
    Ok(Json(json!({ "id": id })))
}

/// `GET /v1/workspaces` — workspaces the caller belongs to.
///
/// # Errors
/// Returns an error if the query fails.
pub(super) async fn list_workspaces(
    State(state): State<AtriumState>,
    Caller(user): Caller,
) -> Result<Json<Value>, AtriumError> {
    let workspaces = state.db().workspaces_for(user.as_str()).await?;
    Ok(Json(json!({ "workspaces": workspaces })))
}

/// `POST /v1/workspaces/:id/invites` — owner mints an invite token.
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller is not the owner.
pub(super) async fn create_invite(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(workspace): Path<String>,
) -> Result<Json<Value>, AtriumError> {
    state.db().require_owner(&workspace, user.as_str()).await?;
    let token = state.db().create_invite(&workspace, user.as_str()).await?;
    Ok(Json(json!({ "token": token })))
}

/// `POST /v1/invites/:token/accept` — caller joins the invite's workspace.
///
/// # Errors
/// [`AtriumError::NotFound`] if the token is unknown or already used.
pub(super) async fn accept_invite(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(token): Path<String>,
) -> Result<Json<Value>, AtriumError> {
    let workspace = state.db().accept_invite(&token, user.as_str()).await?;
    Ok(Json(json!({ "workspace_id": workspace })))
}

/// `GET /v1/workspaces/:id/members` — list members (caller must be a member).
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller is not a member.
pub(super) async fn members(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(workspace): Path<String>,
) -> Result<Json<Value>, AtriumError> {
    state.db().require_member(&workspace, user.as_str()).await?;
    let members = state.db().members(&workspace).await?;
    let list: Vec<Value> = members
        .into_iter()
        .map(|(user_id, role)| json!({ "user_id": user_id, "role": role }))
        .collect();
    Ok(Json(json!({ "members": list })))
}
