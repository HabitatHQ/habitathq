//! Integration tests: embedding `palladium-axum` inside an existing axum project.
//!
//! Each test spins up a small "host" application — a `Router` that already has
//! its own routes, state, and/or middleware — then mounts the Palladium router
//! via either `merge` or `nest`, and asserts that:
//!
//! * All host routes remain reachable and correct.
//! * All Palladium routes are reachable at the expected path.
//! * The `OpenAPI` spec and Swagger UI are served at the expected path.
//! * Neither router's state leaks into the other.
//! * Layering middleware on the combined router does not break either side.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    routing::get,
    Router,
};
use palladium_axum::{create_router, AppState};
use palladium_core::{Change, Hlc, NodeId};
use palladium_sqlite::SqliteStore;
use serde_json::json;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────

const fn node(n: u128) -> NodeId {
    NodeId::from_uuid(Uuid::from_u128(n))
}

/// Build a Palladium router backed by a fresh in-memory `SQLite` store.
async fn palladium() -> Router {
    let store = SqliteStore::in_memory().await.unwrap();
    create_router(AppState::new(store), CorsLayer::permissive())
}

async fn get_ok(app: Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, body.to_vec())
}

async fn post_json(app: Router, uri: &str, json: &str) -> StatusCode {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(json.to_owned()))
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

fn change_json(millis: u64) -> String {
    let h = Hlc::new(node(1), millis);
    let c = Change::new(h, vec![]);
    serde_json::to_string(&c).unwrap()
}

// ── merge: co-existence ───────────────────────────────────────────────────

/// The simplest integration: `Router::merge`. Both routers are `Router<()>`
/// (Palladium's state was applied inside `create_router`), so axum accepts the
/// merge without any type gymnastics.
#[tokio::test]
async fn merge_host_routes_remain_reachable() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(palladium().await);

    let (status, body) = get_ok(app, "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"ok");
}

#[tokio::test]
async fn merge_palladium_routes_reachable_at_root() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(palladium().await);

    let (status, body) = get_ok(app, "/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val, json!([]));
}

#[tokio::test]
async fn merge_unknown_route_returns_404() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(palladium().await);

    let (status, _) = get_ok(app, "/not-a-route").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── nest: subpath mounting ────────────────────────────────────────────────

/// `Router::nest("/sync", palladium)` moves all Palladium routes under `/sync`.
/// `/sync/v1/changes` must be reachable; `/v1/changes` must return 404.
#[tokio::test]
async fn nest_palladium_routes_accessible_at_subpath() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/sync", palladium().await);

    let (status, body) = get_ok(app, "/sync/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val, json!([]));
}

#[tokio::test]
async fn nest_original_path_no_longer_routed() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/sync", palladium().await);

    // Without the prefix, the route must not match.
    let (status, _) = get_ok(app, "/v1/changes").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn nest_host_routes_unaffected() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/sync", palladium().await);

    let (status, body) = get_ok(app, "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"ok");
}

/// POST → GET round-trip through the nested path.
#[tokio::test]
async fn nest_post_then_get_round_trip() {
    let app = Router::new().nest("/sync", palladium().await);

    let status = post_json(app.clone(), "/sync/v1/changes", &change_json(1_000)).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = get_ok(app, "/sync/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
    let changes: Vec<Change> = serde_json::from_slice(&body).unwrap();
    assert_eq!(changes.len(), 1);
}

/// The `?after=` cursor still works when routes are mounted at a subpath.
#[tokio::test]
async fn nest_cursor_pagination_works_at_subpath() {
    let app = Router::new().nest("/sync", palladium().await);

    // Insert three changes with increasing timestamps.
    let h1 = Hlc::new(node(1), 1_000);
    let h2 = h1.send(2_000);
    let h3 = h2.send(3_000);

    for h in [h1, h2, h3] {
        let body = serde_json::to_string(&Change::new(h, vec![])).unwrap();
        let status = post_json(app.clone(), "/sync/v1/changes", &body).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    // Cursor at h1 → expect two results.
    let cursor = h1.sort_key();
    let (status, body) =
        get_ok(app, &format!("/sync/v1/changes?after={cursor}")).await;
    assert_eq!(status, StatusCode::OK);
    let changes: Vec<Change> = serde_json::from_slice(&body).unwrap();
    assert_eq!(changes.len(), 2);
}

// ── OpenAPI spec at various mount points ──────────────────────────────────

#[tokio::test]
async fn merge_openapi_spec_reachable() {
    let app = Router::new().merge(palladium().await);

    let (status, body) = get_ok(app, "/api-doc/openapi.json").await;
    assert_eq!(status, StatusCode::OK);

    let spec: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Top-level fields that must be present in any valid OpenAPI 3.x document.
    assert!(spec.get("openapi").is_some(), "missing 'openapi' version key");
    assert!(spec.get("paths").is_some(), "missing 'paths' key");
    assert!(spec.get("info").is_some(), "missing 'info' key");
}

#[tokio::test]
async fn nest_openapi_spec_reachable_at_subpath() {
    let app = Router::new().nest("/sync", palladium().await);

    let (status, body) = get_ok(app, "/sync/api-doc/openapi.json").await;
    assert_eq!(status, StatusCode::OK);

    let spec: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(spec.get("openapi").is_some());
}

#[tokio::test]
async fn openapi_spec_contains_expected_paths() {
    let app = Router::new().merge(palladium().await);

    let (_, body) = get_ok(app, "/api-doc/openapi.json").await;
    let spec: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let paths = spec["paths"].as_object().unwrap();

    assert!(paths.contains_key("/v1/changes"), "missing GET/POST /v1/changes in spec");
}

#[tokio::test]
async fn swagger_ui_serves_html() {
    let app = Router::new().merge(palladium().await);

    // SwaggerUi redirects /swagger-ui → /swagger-ui/
    let (status, _) = get_ok(app, "/swagger-ui/").await;
    // 200 OK with the Swagger UI HTML page.
    assert_eq!(status, StatusCode::OK);
}

// ── host state isolation ──────────────────────────────────────────────────

/// The host router carries its own application state (`Arc<String>` as a
/// stand-in).  After `.with_state(...)`, it becomes `Router<()>`, and the
/// Palladium router (also `Router<()>`) can be merged cleanly.
#[tokio::test]
async fn host_state_applied_before_merge_isolation() {
    #[derive(Clone)]
    struct HostState {
        message: String,
    }

    let host = Router::new()
        .route(
            "/message",
            get(|State(s): State<HostState>| async move { s.message }),
        )
        .with_state(HostState { message: "hello from host".to_owned() });

    let app = host.merge(palladium().await);

    // Host route still works.
    let (status, body) = get_ok(app.clone(), "/message").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"hello from host");

    // Palladium route also works.
    let (status, body) = get_ok(app, "/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val, json!([]));
}

/// Host state can be any type. The idiomatic pattern is to call `.with_state()`
/// on the host router first (which returns `Router<()>`), then merge/nest the
/// Palladium router (also `Router<()>`). State never leaks across the boundary.
#[tokio::test]
async fn stateful_host_apply_state_then_merge_palladium() {
    #[derive(Clone)]
    struct HostState {
        secret: &'static str,
    }

    // Apply host state first — the router becomes Router<()>.
    let host = Router::new()
        .route(
            "/secret",
            get(|State(s): State<HostState>| async move { s.secret }),
        )
        .with_state(HostState { secret: "hunter2" });

    // Now both are Router<()>; merge is type-safe.
    let app = host.nest("/sync", palladium().await);

    // Host route with state still works.
    let (status, body) = get_ok(app.clone(), "/secret").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"hunter2");

    // Palladium route is accessible at the subpath.
    let (status, _) = get_ok(app, "/sync/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
}

// ── middleware composition ────────────────────────────────────────────────

/// Parent middleware layered on the combined router (after merging) must not
/// break either the host routes or the Palladium routes.
#[tokio::test]
async fn parent_middleware_does_not_break_palladium() {
    use tower_http::{cors::CorsLayer, trace::TraceLayer};

    let app = Router::new()
        .route("/ping", get(|| async { "pong" }))
        .merge(palladium().await)
        // Extra middleware stack on top of the already-layered router.
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let (status, _) = get_ok(app.clone(), "/ping").await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = get_ok(app, "/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
}

/// Middleware added to only the nested Palladium sub-router must not affect the
/// host routes.
#[tokio::test]
async fn middleware_scoped_to_palladium_only() {
    use tower_http::trace::TraceLayer;

    let palladium_with_trace = palladium().await.layer(TraceLayer::new_for_http());

    let app = Router::new()
        .route("/ping", get(|| async { "pong" }))
        .nest("/sync", palladium_with_trace);

    // Both work; no panics or routing failures.
    let (status, _) = get_ok(app.clone(), "/ping").await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = get_ok(app, "/sync/v1/changes").await;
    assert_eq!(status, StatusCode::OK);
}

// ── multiple Palladium instances ──────────────────────────────────────────

/// Edge case: two independent Palladium routers mounted at different subpaths
/// with separate backing stores must not share data.
#[tokio::test]
async fn two_palladium_instances_are_independent() {
    let store_a = SqliteStore::in_memory().await.unwrap();
    let store_b = SqliteStore::in_memory().await.unwrap();

    let app = Router::new()
        .nest("/a", create_router(AppState::new(store_a), CorsLayer::permissive()))
        .nest("/b", create_router(AppState::new(store_b), CorsLayer::permissive()));

    // Write to /a only.
    let status = post_json(app.clone(), "/a/v1/changes", &change_json(1_000)).await;
    assert_eq!(status, StatusCode::CREATED);

    // /a has 1 change, /b has 0.
    let (_, body_a) = get_ok(app.clone(), "/a/v1/changes").await;
    let (_, body_b) = get_ok(app, "/b/v1/changes").await;

    let changes_a: Vec<Change> = serde_json::from_slice(&body_a).unwrap();
    let changes_b: Vec<Change> = serde_json::from_slice(&body_b).unwrap();

    assert_eq!(changes_a.len(), 1, "/a should have 1 change");
    assert_eq!(changes_b.len(), 0, "/b should have 0 changes (independent store)");
}

// ── invalid requests through nested path ─────────────────────────────────

#[tokio::test]
async fn nest_invalid_json_returns_400() {
    let app = Router::new().nest("/sync", palladium().await);

    let status = post_json(app, "/sync/v1/changes", "not json").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn nest_invalid_cursor_returns_400() {
    let app = Router::new().nest("/sync", palladium().await);

    let (status, _) = get_ok(app, "/sync/v1/changes?after=bad_cursor").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
