//! Handlers for the `/health` and `/instances/:name/health` endpoints.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use palladium_core::{ChangeStore, GlobalHealthResponse, InstanceStatus};

use crate::state::AppState;

/// `GET /health` — aggregate health check across all instances.
///
/// Returns `200 OK` with a [`GlobalHealthResponse`] JSON body when the
/// backing store is healthy, or `503 Service Unavailable` on failure.
pub(super) async fn get_health<S>(State(state): State<AppState<S>>) -> impl IntoResponse
where
    S: ChangeStore + Send + Sync + 'static,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let status = probe_store(&state.store).await;
    let ok = status.ok;
    let response = GlobalHealthResponse {
        ok,
        instances: vec![status],
    };
    let code = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(response))
}

/// `GET /instances/:name/health` — per-instance health check.
///
/// Returns `200 OK` with an [`InstanceStatus`] JSON body when healthy,
/// `503 Service Unavailable` on backend failure, or `404 Not Found` if
/// `name` is not `"default"`.
pub(super) async fn get_instance_health<S>(
    State(state): State<AppState<S>>,
    Path(name): Path<String>,
) -> impl IntoResponse
where
    S: ChangeStore + Send + Sync + 'static,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    if name != "default" {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown instance" })),
        )
            .into_response();
    }
    let status = probe_store(&state.store).await;
    let code = if status.ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(status)).into_response()
}

/// Probe the store by running a lightweight query.
///
/// Returns [`InstanceStatus`] with `ok = true` if the query succeeds.
async fn probe_store<S>(store: &Arc<S>) -> InstanceStatus
where
    S: ChangeStore + Send + Sync + 'static,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    match store.list_after(None, Some(0)).await {
        Ok(_) => InstanceStatus {
            name: "default".into(),
            ok: true,
            error: None,
            row_count: None,
            last_hlc: None,
            db_size_bytes: None,
        },
        Err(e) => InstanceStatus {
            name: "default".into(),
            ok: false,
            error: Some(e.to_string()),
            row_count: None,
            last_hlc: None,
            db_size_bytes: None,
        },
    }
}
