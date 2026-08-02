//! Sharing endpoints (Phase 3b): per-member grants and household sharing.
//!
//! Only a root's **owner** may change its sharing (`D17`). Each grant/revoke
//! enqueues an event so the affected member's next poll backfills or purges.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    db::{
        AclRecord, AtriumDb, EVENT_GRANT, EVENT_REVOKE, PERM_READ, PERM_WRITE, SHARING_HOUSEHOLD_READ,
        SHARING_HOUSEHOLD_RW, SHARING_PRIVATE,
    },
    error::AtriumError,
    identity::Caller,
    registry::{self, Shareable, TableRole},
    state::AtriumState,
};

/// Fetch a **root** record and require `caller` to be its owner.
async fn owned_root(db: &AtriumDb, caller: &str, root_id: &str) -> Result<AclRecord, AtriumError> {
    let rec = db
        .get_record(root_id)
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

/// Body for `POST /v1/shares`.
#[derive(Debug, Deserialize)]
pub(super) struct ShareReq {
    root_id: String,
    grantee_user_id: String,
    /// `read` (default) or `write`.
    perm: Option<String>,
}

/// `POST /v1/shares` — grant a specific member access to a per-member root.
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller is not the owner;
/// [`AtriumError::BadRequest`] if the table is not per-member shareable or the
/// grantee is not a workspace member.
pub(super) async fn create_share(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Json(req): Json<ShareReq>,
) -> Result<Json<Value>, AtriumError> {
    let db = state.db();
    let root = owned_root(db, user.as_str(), &req.root_id).await?;
    if !matches!(
        registry::role_of(&root.table_name),
        Some(TableRole::Root(Shareable::PerMember))
    ) {
        return Err(AtriumError::BadRequest(
            "table is not per-member shareable".to_owned(),
        ));
    }
    if db
        .role_of(&root.workspace_id, &req.grantee_user_id)
        .await?
        .is_none()
    {
        return Err(AtriumError::BadRequest(
            "grantee is not a workspace member".to_owned(),
        ));
    }
    let perm = match req.perm.as_deref() {
        Some(PERM_WRITE) => PERM_WRITE,
        None | Some(PERM_READ) => PERM_READ,
        Some(other) => return Err(AtriumError::BadRequest(format!("invalid perm {other}"))),
    };
    db.add_share(&req.root_id, &req.grantee_user_id, perm).await?;
    db.enqueue_event(&req.grantee_user_id, &req.root_id, EVENT_GRANT).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Body for `DELETE /v1/shares`.
#[derive(Debug, Deserialize)]
pub(super) struct UnshareReq {
    root_id: String,
    grantee_user_id: String,
}

/// `DELETE /v1/shares` — revoke a member's grant; enqueues a purge.
///
/// # Errors
/// [`AtriumError::Forbidden`] if the caller is not the owner.
pub(super) async fn delete_share(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Json(req): Json<UnshareReq>,
) -> Result<Json<Value>, AtriumError> {
    let db = state.db();
    owned_root(db, user.as_str(), &req.root_id).await?;
    db.remove_share(&req.root_id, &req.grantee_user_id).await?;
    db.enqueue_event(&req.grantee_user_id, &req.root_id, EVENT_REVOKE).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Body for `PATCH /v1/records/:root_id/sharing`.
#[derive(Debug, Deserialize)]
pub(super) struct SharingReq {
    /// `private`, `household_read`, or `household_rw`.
    class: String,
}

/// `PATCH /v1/records/:root_id/sharing` — set household sharing on a root.
///
/// # Errors
/// [`AtriumError::Forbidden`] if not the owner; [`AtriumError::BadRequest`] for
/// an invalid class or a non-household-shareable table.
pub(super) async fn set_sharing(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(root_id): Path<String>,
    Json(req): Json<SharingReq>,
) -> Result<Json<Value>, AtriumError> {
    let db = state.db();
    let root = owned_root(db, user.as_str(), &root_id).await?;
    let class = match req.class.as_str() {
        SHARING_PRIVATE => SHARING_PRIVATE,
        SHARING_HOUSEHOLD_READ => SHARING_HOUSEHOLD_READ,
        SHARING_HOUSEHOLD_RW => SHARING_HOUSEHOLD_RW,
        other => return Err(AtriumError::BadRequest(format!("invalid sharing class {other}"))),
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
    db.set_sharing(&root_id, class).await?;

    // Notify the other members: grant (backfill) when shared, revoke (purge)
    // when returned to private.
    let kind = if class == SHARING_PRIVATE { EVENT_REVOKE } else { EVENT_GRANT };
    for member in db.member_ids(&root.workspace_id).await? {
        if member != root.owner_user_id {
            db.enqueue_event(&member, &root_id, kind).await?;
        }
    }
    Ok(Json(json!({ "ok": true })))
}
