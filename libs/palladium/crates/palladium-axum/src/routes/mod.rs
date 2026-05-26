//! HTTP route handlers and the main [`Router`] factory.

// utoipa's `#[derive(OpenApi)]` generates a `for_each` loop internally;
// suppress the false-positive lint that fires in the generated impl.
#![allow(clippy::needless_for_each)]

mod blobs;
mod changes;
mod health;

use axum::{
    routing::{delete, get, post},
    Router,
};
use palladium_core::ChangeStore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::state::AppState;
use blobs::{delete_blob, get_blob, get_presigned, post_blob};
use changes::{get_changes, post_changes};
use health::{get_health, get_instance_health};

/// `OpenAPI` specification for the Palladium sync engine REST API.
#[derive(OpenApi)]
#[openapi(
    paths(changes::post_changes, changes::get_changes),
    components(schemas(
        palladium_core::Change,
        palladium_core::Op,
        palladium_core::Hlc,
        palladium_core::NodeId,
        crate::error::ErrorBody,
    )),
    tags((name = "changes", description = "Sync change log endpoints")),
    info(
        title = "Palladium Sync Engine",
        version = "0.1.0",
        description = "Local-first sync engine — change replication API",
        license(name = "SEE LICENSE IN LICENSE"),
    )
)]
pub struct ApiDoc;

/// Build the versioned API router with all routes and middleware.
///
/// The router includes:
/// - `POST /v1/changes` and `GET /v1/changes` — sync endpoints
/// - `POST /v1/blobs`, `GET /v1/blobs/:id`, `DELETE /v1/blobs/:id` — blob endpoints
/// - `GET /v1/blobs/:id/presigned` — pre-signed URL endpoint
/// - `GET /swagger-ui/` — interactive Swagger UI
/// - `GET /api-doc/openapi.json` — machine-readable `OpenAPI` spec
///
/// `cors` controls cross-origin access. Use [`CorsLayer::permissive`] during
/// development or supply a stricter policy for production.
///
/// Mount this router under your chosen base path, or serve it directly.
pub fn create_router<S>(state: AppState<S>, cors: CorsLayer) -> Router
where
    S: ChangeStore + Send + Sync + 'static,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    // Apply state to the API routes first so they become Router<()>.
    let api = Router::new()
        .route("/v1/changes", post(post_changes::<S>))
        .route("/v1/changes", get(get_changes::<S>))
        .route("/v1/health", get(get_health::<S>))
        .route("/v1/instances/:name/health", get(get_instance_health::<S>))
        .route("/v1/blobs", post(post_blob::<S>))
        .route("/v1/blobs/:id", get(get_blob::<S>))
        .route("/v1/blobs/:id", delete(delete_blob::<S>))
        .route("/v1/blobs/:id/presigned", get(get_presigned::<S>))
        .with_state(state);

    Router::new()
        .merge(api)
        .merge(SwaggerUi::new("/swagger-ui").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}
