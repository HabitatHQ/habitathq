//! Blob channel with parent-note ACL (Phase 3c).
//!
//! Blobs (e.g. `note_images` payloads) are binary and travel outside the JSON
//! change stream. A blob inherits its ACL from the note it hangs off (`D18`):
//! uploading requires **write** on the note, downloading requires **read**.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{
        header::{HeaderValue, CONTENT_TYPE},
        HeaderMap, StatusCode,
    },
    response::IntoResponse,
};

use crate::{
    error::AtriumError,
    identity::Caller,
    registry::{self, TableRole},
    state::AtriumState,
};

/// Header naming the target workspace (mirrors `changes`).
const WORKSPACE_HEADER: &str = "x-workspace";
/// Header naming the note (aggregate root) a blob belongs to.
const NOTE_HEADER: &str = "x-note";
/// Fallback MIME type when the client sends none.
const DEFAULT_CONTENT_TYPE: &str = "application/octet-stream";

/// Read a required, non-empty request header.
fn require_header(headers: &HeaderMap, name: &str) -> Result<String, AtriumError> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AtriumError::BadRequest(format!("missing {name} header")))
}

/// `PUT /v1/blobs/:blob_id` — store a blob under a note the caller may write.
///
/// # Errors
/// [`AtriumError::BadRequest`] on a missing header or a non-root note;
/// [`AtriumError::NotFound`] if the note is unknown;
/// [`AtriumError::Forbidden`] if the caller may not write the note.
pub(super) async fn put_blob(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(blob_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AtriumError> {
    let workspace = require_header(&headers, WORKSPACE_HEADER)?;
    let note_id = require_header(&headers, NOTE_HEADER)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;

    let note = db
        .get_record(&workspace, &note_id)
        .await?
        .ok_or_else(|| AtriumError::NotFound(format!("note {note_id} not found")))?;
    if note.workspace_id != workspace {
        return Err(AtriumError::BadRequest(
            "note is not in this workspace".to_owned(),
        ));
    }
    if note.root_id.is_some()
        || !matches!(
            registry::role_of(&note.table_name),
            Some(TableRole::Root(_))
        )
    {
        return Err(AtriumError::BadRequest(
            "blobs attach to a root note".to_owned(),
        ));
    }
    if !db.can_write(&workspace, user.as_str(), &note_id).await? {
        return Err(AtriumError::Forbidden(format!(
            "no write access to note {note_id}"
        )));
    }

    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_CONTENT_TYPE);
    db.put_blob(
        &blob_id,
        &workspace,
        &note_id,
        user.as_str(),
        content_type,
        &body,
    )
    .await?;
    Ok(StatusCode::CREATED)
}

/// `GET /v1/blobs/:blob_id` — return the blob if the caller may read its note.
///
/// # Errors
/// [`AtriumError::NotFound`] if the blob is unknown;
/// [`AtriumError::Forbidden`] if the caller is not a member or may not read the
/// owning note.
pub(super) async fn get_blob(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    Path(blob_id): Path<String>,
) -> Result<impl IntoResponse, AtriumError> {
    let db = state.db();
    let blob = db
        .get_blob(&blob_id)
        .await?
        .ok_or_else(|| AtriumError::NotFound(format!("blob {blob_id} not found")))?;
    db.require_member(&blob.workspace_id, user.as_str()).await?;
    if !db
        .can_read(&blob.workspace_id, user.as_str(), &blob.note_id)
        .await?
    {
        return Err(AtriumError::Forbidden(format!(
            "no read access to blob {blob_id}"
        )));
    }
    let content_type = HeaderValue::from_str(&blob.content_type)
        .unwrap_or_else(|_| HeaderValue::from_static(DEFAULT_CONTENT_TYPE));
    Ok(([(CONTENT_TYPE, content_type)], blob.bytes))
}
