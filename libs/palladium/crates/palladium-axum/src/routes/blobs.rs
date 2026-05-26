//! Handlers for the `/v1/blobs` endpoints.
//!
//! These endpoints require a [`DynBlobStore`] to be configured in [`AppState`].
//! If none is set every handler returns a 400 error.

use axum::{
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use palladium_blobs::BlobId;
use palladium_core::ChangeStore;
use serde::Serialize;
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

// ── Response types ────────────────────────────────────────────────────────

/// Response body for `POST /v1/blobs`.
#[derive(Serialize)]
struct BlobCreated {
    id: Uuid,
    size: u64,
    mime: String,
}

/// Response body for `GET /v1/blobs/:id/presigned`.
#[derive(Serialize)]
struct PresignedUrl {
    url: String,
}

// ── Helper ────────────────────────────────────────────────────────────────

/// Return a 400 error when no blob store is configured.
fn no_blob_store() -> AppError {
    AppError::BadRequest("blob storage is not configured".into())
}

/// Map a [`palladium_blobs::BlobError`] to an [`AppError`].
fn blob_err(e: palladium_blobs::BlobError) -> AppError {
    if matches!(e, palladium_blobs::BlobError::NotFound(_)) {
        AppError::NotFound
    } else {
        AppError::internal(e)
    }
}

// ── Default TTL for pre-signed URLs ──────────────────────────────────────

/// Default TTL for pre-signed URLs (15 minutes).
const DEFAULT_PRESIGN_TTL_SECS: u64 = 900;

// ── POST /v1/blobs ────────────────────────────────────────────────────────

/// `POST /v1/blobs` — upload a blob via `multipart/form-data`.
///
/// Expects a `multipart/form-data` body with a field named `file`.
/// Returns `201 Created` with `{ "id": "<uuid>", "size": <bytes>, "mime": "..." }`.
pub(super) async fn post_blob<S>(
    State(state): State<AppState<S>>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let bs = state.blob_store.as_ref().ok_or_else(no_blob_store)?;

    // Collect all bytes from the `file` multipart field.
    let mut data: Option<(Vec<u8>, String)> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(format!("multipart error: {e}"))
    })? {
        if field.name() == Some("file") {
            let mime = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_owned();
            let bytes = field.bytes().await.map_err(|e| {
                AppError::BadRequest(format!("failed to read field: {e}"))
            })?;
            data = Some((bytes.to_vec(), mime));
            break;
        }
    }

    let (bytes, mime) = data.ok_or_else(|| AppError::BadRequest("missing `file` field".into()))?;
    let id: BlobId = Uuid::new_v4();
    #[allow(clippy::cast_possible_truncation)]
    let size = bytes.len() as u64;

    bs.put(id, &bytes).await.map_err(AppError::internal)?;

    Ok((StatusCode::CREATED, Json(BlobCreated { id, size, mime })))
}

// ── GET /v1/blobs/:id ─────────────────────────────────────────────────────

/// `GET /v1/blobs/:id` — download blob bytes.
///
/// Returns the raw bytes with `Content-Type: application/octet-stream`.
/// Returns `404` if the blob does not exist or has been deleted.
pub(super) async fn get_blob<S>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let bs = state.blob_store.as_ref().ok_or_else(no_blob_store)?;

    let bytes = bs.get(id).await.map_err(blob_err)?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(bytes))
        .map_err(AppError::internal)
}

// ── DELETE /v1/blobs/:id ──────────────────────────────────────────────────

/// `DELETE /v1/blobs/:id` — soft-delete a blob.
///
/// Returns `204 No Content` on success, `404` if the blob is unknown.
pub(super) async fn delete_blob<S>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let bs = state.blob_store.as_ref().ok_or_else(no_blob_store)?;

    bs.delete(id).await.map_err(blob_err)?;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /v1/blobs/:id/presigned ──────────────────────────────────────────

/// `GET /v1/blobs/:id/presigned` — generate a pre-signed download URL.
///
/// Returns `{ "url": "…" }` if the backend supports pre-signed URLs.
/// Returns `501 Not Implemented` if the backend does not support it.
pub(super) async fn get_presigned<S>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let bs = state.blob_store.as_ref().ok_or_else(no_blob_store)?;

    Ok(bs
        .presigned_get_url(id, DEFAULT_PRESIGN_TTL_SECS)
        .map_or_else(
            || {
                (
                    StatusCode::NOT_IMPLEMENTED,
                    Json(serde_json::json!({
                        "error": "presigned URLs not supported by this backend"
                    })),
                )
                    .into_response()
            },
            |url| Json(PresignedUrl { url }).into_response(),
        ))
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        Router,
    };
    use palladium_blobs::filesystem::FilesystemBlobStore;
    use palladium_sqlite::SqliteStore;
    use tower::ServiceExt;
    use tower_http::cors::CorsLayer;

    use crate::{create_router, AppState};

    async fn app_with_blobs() -> (Router, tempfile::TempDir) {
        let store = SqliteStore::in_memory().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let bs = FilesystemBlobStore::new(dir.path());
        let state = AppState::new(store).with_blob_store(bs);
        let router = create_router(state, CorsLayer::permissive());
        (router, dir)
    }

    async fn app_no_blobs() -> Router {
        let store = SqliteStore::in_memory().await.unwrap();
        let state = AppState::new(store);
        create_router(state, CorsLayer::permissive())
    }

    /// Build a minimal `multipart/form-data` body with a single `file` field.
    fn multipart_body(content: &[u8], content_type: &str) -> (String, Vec<u8>) {
        let boundary = "testboundary1234";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            "Content-Disposition: form-data; name=\"file\"; filename=\"test.bin\"\r\n"
                .as_bytes(),
        );
        body.extend_from_slice(
            format!("Content-Type: {content_type}\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(content);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        (
            format!("multipart/form-data; boundary={boundary}"),
            body,
        )
    }

    #[tokio::test]
    async fn post_blob_returns_201_with_id() {
        let (router, _dir) = app_with_blobs().await;
        let (ct, body) = multipart_body(b"hello world", "text/plain");

        let resp = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/blobs")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(val["id"].is_string());
        assert_eq!(val["size"], 11);
    }

    #[tokio::test]
    async fn get_blob_after_upload() {
        let (router, _dir) = app_with_blobs().await;
        let payload = b"some content";
        let (ct, body) = multipart_body(payload, "application/octet-stream");

        // Upload
        let post_resp = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/blobs")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_resp.status(), StatusCode::CREATED);
        let post_bytes = axum::body::to_bytes(post_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&post_bytes).unwrap();
        let id = created["id"].as_str().unwrap().to_owned();

        // Download
        let get_resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/blobs/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get_resp.status(), StatusCode::OK);
        let got = axum::body::to_bytes(get_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(got.as_ref(), payload);
    }

    #[tokio::test]
    async fn get_missing_blob_returns_404() {
        let (router, _dir) = app_with_blobs().await;
        let resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/blobs/{}", uuid::Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_blob_returns_204() {
        let (router, _dir) = app_with_blobs().await;
        let (ct, body) = multipart_body(b"to delete", "text/plain");

        let post_resp = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/blobs")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let post_bytes = axum::body::to_bytes(post_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&post_bytes).unwrap();
        let id = created["id"].as_str().unwrap().to_owned();

        let del_resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/v1/blobs/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn get_after_delete_returns_404() {
        let (router, _dir) = app_with_blobs().await;
        let (ct, body) = multipart_body(b"gone", "text/plain");

        let post_resp = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/blobs")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let post_bytes = axum::body::to_bytes(post_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&post_bytes).unwrap();
        let id = created["id"].as_str().unwrap().to_owned();

        router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/v1/blobs/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let get_resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/blobs/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get_resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn presigned_returns_501_for_filesystem() {
        let (router, _dir) = app_with_blobs().await;
        let resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/blobs/{}/presigned", uuid::Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
    }

    #[tokio::test]
    async fn no_blob_store_returns_error() {
        let router = app_no_blobs().await;
        let (ct, body) = multipart_body(b"data", "text/plain");
        let resp = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/blobs")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        // Returns 400 — blob storage is not configured.
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
