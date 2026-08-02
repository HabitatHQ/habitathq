//! HTTP handlers and the client-facing [`Router`] factory.

mod changes;
mod health;
mod shares;
mod workspaces;

use axum::{
    routing::{get, patch, post},
    Router,
};
use tower_http::cors::CorsLayer;

use crate::state::AtriumState;

/// Build Atrium's client-facing router.
///
/// Routes:
/// - `GET /v1/health`
/// - `POST /v1/workspaces`, `GET /v1/workspaces`
/// - `POST /v1/workspaces/:id/invites`, `GET /v1/workspaces/:id/members`
/// - `POST /v1/invites/:token/accept`
/// - `POST /v1/changes`, `GET /v1/changes` (ACL-filtered, `{changes, purges}`)
/// - `POST /v1/shares`, `DELETE /v1/shares`, `PATCH /v1/records/:root_id/sharing`
///
/// `cors` controls cross-origin access (use [`CorsLayer::permissive`] in dev).
pub fn create_router(state: AtriumState, cors: CorsLayer) -> Router {
    Router::new()
        .route("/v1/health", get(health::get_health))
        .route(
            "/v1/workspaces",
            post(workspaces::create_workspace).get(workspaces::list_workspaces),
        )
        .route("/v1/workspaces/:id/invites", post(workspaces::create_invite))
        .route("/v1/workspaces/:id/members", get(workspaces::members))
        .route("/v1/invites/:token/accept", post(workspaces::accept_invite))
        .route(
            "/v1/changes",
            post(changes::post_changes).get(changes::get_changes),
        )
        .route(
            "/v1/shares",
            post(shares::create_share).delete(shares::delete_share),
        )
        .route(
            "/v1/records/:root_id/sharing",
            patch(shares::set_sharing),
        )
        .with_state(state)
        .layer(cors)
}
