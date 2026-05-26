//! Tests for the `GET /v1/health` and `GET /v1/instances/:name/health` endpoints.
#![allow(clippy::unwrap_used, missing_docs)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use palladium_axum::{create_router, AppState};
use palladium_sqlite::SqliteStore;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;

async fn app() -> axum::Router {
    let store = SqliteStore::in_memory().await.unwrap();
    create_router(AppState::new(store), CorsLayer::permissive())
}

#[tokio::test]
async fn get_health_returns_200() {
    let resp = app()
        .await
        .oneshot(Request::builder().uri("/v1/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(val["ok"], true);
    assert!(val["instances"].is_array());
    assert_eq!(val["instances"].as_array().unwrap().len(), 1);
    assert_eq!(val["instances"][0]["name"], "default");
    assert_eq!(val["instances"][0]["ok"], true);
}

#[tokio::test]
async fn get_instance_health_default_returns_200() {
    let resp = app()
        .await
        .oneshot(
            Request::builder()
                .uri("/v1/instances/default/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(val["name"], "default");
    assert_eq!(val["ok"], true);
}

#[tokio::test]
async fn get_instance_health_unknown_returns_404() {
    let resp = app()
        .await
        .oneshot(
            Request::builder()
                .uri("/v1/instances/nonexistent/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
