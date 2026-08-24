//! Sharing endpoints: per-member grants and household sharing.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    db::{
        AclRecord, AtriumDb, EVENT_GRANT, EVENT_REVOKE, PERM_READ, PERM_WRITE,
        SHARING_HOUSEHOLD_READ, SHARING_HOUSEHOLD_RW, SHARING_PRIVATE,
    },
    error::AtriumError,
    identity::Caller,
    registry::{self, Shareable, TableRole},
    state::AtriumState,
};

fn workspace_of(headers: &HeaderMap) -> Result<String, AtriumError> {
    headers
        .get("x-workspace")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AtriumError::BadRequest("missing x-workspace header".to_owned()))
}

async fn owned_root(
    db: &AtriumDb,
    workspace: &str,
    caller: &str,
    root_id: &str,
) -> Result<AclRecord, AtriumError> {
    let rec = db
        .get_record(workspace, root_id)
        .await?
        .ok_or_else(|| AtriumError::NotFound(format!("record {root_id} not found")))?;
    if rec.root_id.is_some() {
        return Err(AtriumError::BadRequest(
            "sharing can only be set on a root record".to_owned(),
        ));
    }
    if rec.owner_user_id != caller {
        return Err(AtriumError::Forbidden(
            "only the owner may change sharing".to_owned(),
        ));
    }
    Ok(rec)
}

#[derive(Debug, Deserialize)]
pub(super) struct ShareReq {
    root_id: String,
    grantee_user_id: String,
    perm: Option<String>,
}

pub(super) async fn create_share(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(req): Json<ShareReq>,
) -> Result<Json<Value>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    let root = owned_root(db, &workspace, user.as_str(), &req.root_id).await?;
    if !matches!(
        registry::role_of(&root.table_name),
        Some(TableRole::Root(Shareable::PerMember))
    ) {
        return Err(AtriumError::BadRequest(
            "table is not per-member shareable".to_owned(),
        ));
    }
    db.require_member(&workspace, &req.grantee_user_id).await?;
    let perm = match req.perm.as_deref() {
        Some(PERM_WRITE) => PERM_WRITE,
        None | Some(PERM_READ) => PERM_READ,
        Some(other) => return Err(AtriumError::BadRequest(format!("invalid perm {other}"))),
    };
    db.add_share(&workspace, &req.root_id, &req.grantee_user_id, perm)
        .await?;
    db.enqueue_event(&workspace, &req.grantee_user_id, &req.root_id, EVENT_GRANT)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub(super) struct UnshareReq {
    root_id: String,
    grantee_user_id: String,
}

pub(super) async fn delete_share(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(req): Json<UnshareReq>,
) -> Result<Json<Value>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    owned_root(db, &workspace, user.as_str(), &req.root_id).await?;
    db.remove_share(&workspace, &req.root_id, &req.grantee_user_id)
        .await?;
    db.enqueue_event(&workspace, &req.grantee_user_id, &req.root_id, EVENT_REVOKE)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub(super) struct SharingReq {
    class: String,
}

pub(super) async fn set_sharing(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Path(root_id): Path<String>,
    Json(req): Json<SharingReq>,
) -> Result<Json<Value>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    let root = owned_root(db, &workspace, user.as_str(), &root_id).await?;
    let class = match req.class.as_str() {
        SHARING_PRIVATE => SHARING_PRIVATE,
        SHARING_HOUSEHOLD_READ => SHARING_HOUSEHOLD_READ,
        SHARING_HOUSEHOLD_RW => SHARING_HOUSEHOLD_RW,
        other => {
            return Err(AtriumError::BadRequest(format!(
                "invalid sharing class {other}"
            )))
        }
    };
    if class != SHARING_PRIVATE
        && !matches!(
            registry::role_of(&root.table_name),
            Some(TableRole::Root(Shareable::Household))
        )
    {
        return Err(AtriumError::BadRequest(
            "table is not household-shareable".to_owned(),
        ));
    }
    db.set_sharing(&workspace, &root_id, class).await?;
    let kind = if class == SHARING_PRIVATE {
        EVENT_REVOKE
    } else {
        EVENT_GRANT
    };
    for member in db.member_ids(&workspace).await? {
        if member != root.owner_user_id {
            db.enqueue_event(&workspace, &member, &root_id, kind)
                .await?;
        }
    }
    Ok(Json(json!({ "ok": true })))
}
