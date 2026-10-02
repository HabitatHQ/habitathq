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
use palladium_axum::{create_router, AppState, BearerAuthenticator, BearerScopeAuthorizer};
use palladium_core::{Change, ClockError, Hlc, NodeId, Op, ServerClock};
use palladium_sqlite::SqliteStore;
use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct FixedClock(Arc<AtomicU64>);

impl ServerClock for FixedClock {
    fn now_millis(&self) -> Result<u64, ClockError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
fn page(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap()
}

// ── helpers ───────────────────────────────────────────────────────────────

/// Build a Palladium router backed by a fresh in-memory `SQLite` store.
async fn palladium() -> Router {
    let store = SqliteStore::in_memory().await.unwrap();
    create_router(AppState::new(store), CorsLayer::permissive())
}
async fn clock_app(now: u64) -> (Router, Arc<AtomicU64>) {
    let store = SqliteStore::in_memory().await.unwrap();
    let time = Arc::new(AtomicU64::new(now));
    let state = AppState::new(store)
        .with_authenticator(BearerAuthenticator)
        .with_authorizer(BearerScopeAuthorizer)
        .with_clock(FixedClock(Arc::clone(&time)));
    (create_router(state, CorsLayer::permissive()), time)
}

async fn post_json_value(app: Router, body: &str) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/changes")
                .header("authorization", "Bearer alice")
                .header("content-type", "application/json")
                .body(Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, page(&bytes))
}

async fn get_ok(app: Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let row_id = Uuid::now_v7();
    let change = Change::new(
        Hlc::new(NodeId::new(), millis),
        vec![Op::Insert {
            table: "todos".into(),
            row_id,
            data: json!({"id": row_id}),
        }],
    );
    serde_json::to_string(&change).unwrap()
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
    let val = page(&body);
    assert_eq!(val["version"], json!(1));
    assert_eq!(val["changes"], json!([]));
    assert_eq!(val["purges"], json!([]));
    assert_eq!(val["events"], json!([]));
    assert_eq!(val["cursor"], serde_json::Value::Null);
    assert_eq!(val["upperBound"], json!("1"));
    assert_eq!(val["caughtUp"], json!(true));
    assert_eq!(val["control"]["mustRefetch"], json!(false));
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

    let (_, body) = get_ok(app, "/sync/v1/changes").await;
    let val = page(&body);
    assert_eq!(val["changes"], json!([]));
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

    let (_, body) = get_ok(app, "/sync/v1/changes").await;
    let changes = page(&body)["changes"].as_array().unwrap().len();
    assert_eq!(changes, 1);
}

/// Append-position cursor pagination works when routes are mounted at a subpath.
#[tokio::test]
async fn nest_cursor_pagination_works_at_subpath() {
    let app = Router::new().nest("/sync", palladium().await);

    for millis in [1_000, 2_000, 3_000] {
        let status = post_json(app.clone(), "/sync/v1/changes", &change_json(millis)).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    // Cursor at append position one → expect two results.
    let (status, body) = get_ok(app, "/sync/v1/changes?cursor=1").await;
    assert_eq!(status, StatusCode::OK);
    let changes = page(&body)["changes"].as_array().unwrap().len();
    assert_eq!(changes, 2);
}

// ── OpenAPI spec at various mount points ──────────────────────────────────

#[tokio::test]
async fn merge_openapi_spec_reachable() {
    let app = Router::new().merge(palladium().await);

    let (status, body) = get_ok(app, "/api-doc/openapi.json").await;
    assert_eq!(status, StatusCode::OK);

    let spec: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Top-level fields that must be present in any valid OpenAPI 3.x document.
    assert!(
        spec.get("openapi").is_some(),
        "missing 'openapi' version key"
    );
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

    assert!(
        paths.contains_key("/v1/changes"),
        "missing GET/POST /v1/changes in spec"
    );
    assert!(
        paths.contains_key("/v1/clock"),
        "missing GET /v1/clock in spec"
    );
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
        .with_state(HostState {
            message: "hello from host".to_owned(),
        });

    let app = host.merge(palladium().await);

    // Host route still works.
    let (status, body) = get_ok(app.clone(), "/message").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"hello from host");

    // Palladium route also works.
    let (_, body) = get_ok(app, "/v1/changes").await;
    let val = page(&body);
    assert_eq!(val["changes"], json!([]));
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
        .nest(
            "/a",
            create_router(AppState::new(store_a), CorsLayer::permissive()),
        )
        .nest(
            "/b",
            create_router(AppState::new(store_b), CorsLayer::permissive()),
        );

    // Write to /a only.
    let status = post_json(app.clone(), "/a/v1/changes", &change_json(1_000)).await;
    assert_eq!(status, StatusCode::CREATED);

    // /a has 1 change, /b has 0.
    let (_, body_a) = get_ok(app.clone(), "/a/v1/changes").await;
    let (_, body_b) = get_ok(app, "/b/v1/changes").await;
    let changes_a = page(&body_a)["changes"].as_array().unwrap().len();
    let changes_b = page(&body_b)["changes"].as_array().unwrap().len();

    assert_eq!(changes_a, 1, "/a should have 1 change");
    assert_eq!(changes_b, 0, "/b should have 0 changes (independent store)");
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

    let (status, _) = get_ok(app, "/sync/v1/changes?cursor=bad_cursor").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn future_hlc_is_rejected_with_clock_skew_classification() {
    let app = Router::new().nest("/sync", palladium().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sync/v1/changes")
                .header("content-type", "application/json")
                .body(Body::from(change_json(i64::MAX as u64)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let error = page(&body);
    assert_eq!(error["code"], json!("clock_skew"));
}
#[tokio::test]
async fn clock_is_authenticated_and_returns_the_v1_server_contract() {
    let (app, _) = clock_app(1_700_000_000_123).await;
    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/clock")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/clock")
                .header("authorization", "Bearer alice")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        page(&bytes),
        json!({
            "version": 1,
            "nowMs": 1_700_000_000_123_u64,
            "maxFutureMs": 300_000,
        })
    );
}

#[tokio::test]
async fn fresh_clock_skew_is_rejected_but_identical_rollback_retry_precedes_skew() {
    let (app, now) = clock_app(10_000).await;
    let accepted = change_json(310_000);
    let (status, receipt) = post_json_value(app.clone(), &accepted).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(receipt["outcome"], json!("inserted"));
    let cursor = receipt["cursor"].clone();

    now.store(0, Ordering::SeqCst);
    let (retry_status, retry) = post_json_value(app.clone(), &accepted).await;
    assert_eq!(retry_status, StatusCode::CREATED);
    assert_eq!(retry["outcome"], json!("duplicate"));
    assert_eq!(retry["cursor"], cursor);

    let changed_payload = accepted.replace("310000", "310001");
    let (conflict_status, conflict) = post_json_value(app.clone(), &changed_payload).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
    assert_eq!(conflict["code"], json!("idempotency_conflict"));

    let fresh_skewed = change_json(300_001);
    let (skew_status, skew) = post_json_value(app.clone(), &fresh_skewed).await;
    assert_eq!(skew_status, StatusCode::BAD_REQUEST);
    assert_eq!(skew["code"], json!("clock_skew"));

    let history = app
        .oneshot(
            Request::builder()
                .uri("/v1/changes")
                .header("authorization", "Bearer alice")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(history.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(history.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(page(&bytes)["changes"].as_array().unwrap().len(), 1);
}
