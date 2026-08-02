//! Health endpoint.

use axum::{response::IntoResponse, Json};
use serde_json::json;

/// `GET /v1/health` — liveness probe.
// `async` is required by axum's `Handler` trait even though this body never
// awaits, so the `unused_async` lint is a false positive here.
#[allow(clippy::unused_async)]
pub(super) async fn get_health() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}
