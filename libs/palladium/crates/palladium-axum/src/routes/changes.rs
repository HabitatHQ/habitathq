//! Handlers for the `/v1/changes` endpoints.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use palladium_core::{Change, ChangeStore, Hlc};
use serde::Deserialize;

use crate::{error::AppError, state::AppState};
// `ErrorBody` is referenced only inside `#[utoipa::path]` response body
// annotations; proc-macro usage is invisible to rustc's unused-import check.
#[allow(unused_imports)]
use crate::error::ErrorBody;

/// Query parameters for `GET /v1/changes`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub(super) struct ListQuery {
    /// Return only changes whose HLC sort-key is strictly after this value.
    ///
    /// Format: `{millis:020}_{counter:010}_{node_id_hex:032x}`
    #[param(required = false, example = "00000000001700000000_0000000000_00000000000000000000000000000001")]
    after: Option<String>,

    /// Maximum number of changes to return. Omit for no limit.
    #[param(required = false, example = 100)]
    limit: Option<u32>,
}

/// `POST /v1/changes` — accept a batch of changes from a client.
///
/// Returns `201 Created` on success, or an error response.
#[utoipa::path(
    post,
    path = "/v1/changes",
    tag = "changes",
    request_body(content = Change, content_type = "application/json"),
    responses(
        (status = 201, description = "Change accepted"),
        (status = 400, description = "Invalid request body", body = ErrorBody),
        (status = 500, description = "Internal server error", body = ErrorBody),
    )
)]
pub(super) async fn post_changes<S>(
    State(state): State<AppState<S>>,
    Json(change): Json<Change>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    state.store.insert(&change).await.map_err(AppError::internal)?;
    Ok(StatusCode::CREATED)
}

/// `GET /v1/changes` — list changes, optionally paginated by HLC cursor.
///
/// Pass `?after=<hlc_sort_key>` to page forward. Omit for all changes.
/// Pass `?limit=<n>` to cap the number of results returned.
#[utoipa::path(
    get,
    path = "/v1/changes",
    tag = "changes",
    params(ListQuery),
    responses(
        (status = 200, description = "List of changes", body = Vec<Change>),
        (status = 400, description = "Invalid cursor format", body = ErrorBody),
        (status = 500, description = "Internal server error", body = ErrorBody),
    )
)]
pub(super) async fn get_changes<S>(
    State(state): State<AppState<S>>,
    Query(params): Query<ListQuery>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let after = params.after.as_deref().map(parse_hlc_key).transpose()?;
    let changes = state
        .store
        .list_after(after, params.limit)
        .await
        .map_err(AppError::internal)?;
    Ok(Json(changes))
}

/// Parse a sort-key string back into an [`Hlc`] for use as a pagination cursor.
fn parse_hlc_key(key: &str) -> Result<Hlc, AppError> {
    key.parse::<Hlc>().map_err(|msg| {
        tracing::debug!(%key, %msg, "rejected invalid cursor");
        AppError::BadRequest(format!("invalid after cursor: {key}"))
    })
}

#[cfg(test)]
const fn node(n: u128) -> palladium_core::NodeId {
    palladium_core::NodeId::from_uuid(uuid::Uuid::from_u128(n))
}

#[cfg(test)]
mod tests {
    use super::{node, parse_hlc_key};
    use palladium_core::Hlc;

    #[test]
    fn parse_hlc_key_round_trips() {
        let hlc = Hlc::from_parts(1_234_567, 42, node(99));
        let key = hlc.sort_key();
        #[allow(clippy::unwrap_used)]
        let parsed = parse_hlc_key(&key).unwrap();
        assert_eq!(parsed, hlc);
    }

    #[test]
    fn parse_hlc_key_invalid_returns_bad_request() {
        assert!(parse_hlc_key("not_a_cursor").is_err());
        assert!(parse_hlc_key("abc_def_ghij").is_err());
    }

    #[test]
    fn parse_hlc_key_too_few_parts() {
        assert!(parse_hlc_key("00000000000000001000").is_err());
    }

    #[test]
    fn parse_hlc_key_non_numeric_millis() {
        let bad = "zzzzzzzzzzzzzzzzzzzz_0000000000_00000000000000000000000000000000";
        assert!(parse_hlc_key(bad).is_err());
    }

    #[test]
    fn parse_hlc_key_non_numeric_counter() {
        let bad = "00000000000000001000_xxxxxxxxxx_00000000000000000000000000000000";
        assert!(parse_hlc_key(bad).is_err());
    }

    #[test]
    fn parse_hlc_key_non_hex_node_id() {
        let bad = "00000000000000001000_0000000042_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
        assert!(parse_hlc_key(bad).is_err());
    }
}

// ── HTTP integration tests ────────────────────────────────────────────────

#[cfg(test)]
mod http_tests {
    #[allow(clippy::wildcard_imports)]
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use palladium_core::{Change, Hlc};
    use palladium_sqlite::SqliteStore;
    use serde_json::json;
    use tower::ServiceExt;
    use tower_http::cors::CorsLayer;

    use super::node;
    use crate::{create_router, AppState};

    async fn app() -> axum::Router {
        #[allow(clippy::unwrap_used)]
        let store = SqliteStore::in_memory().await.unwrap();
        let state = AppState::new(store);
        create_router(state, CorsLayer::permissive())
    }

    // ── GET /v1/changes ──────────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn get_changes_empty_returns_200_and_array() {
        let resp = app()
            .await
            .oneshot(Request::builder().uri("/v1/changes").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(val, json!([]));
    }

    // ── POST /v1/changes ─────────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn post_change_returns_201() {
        let n = node(1);
        let change = Change::new(Hlc::new(n, 1_000), vec![]);
        let body = serde_json::to_string(&change).unwrap();

        let resp = app()
            .await
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/changes")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn post_invalid_json_returns_400() {
        let resp = app()
            .await
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/changes")
                    .header("content-type", "application/json")
                    .body(Body::from("not json at all"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    // ── POST → GET round-trip ─────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn post_then_get_returns_change() {
        let n = node(1);
        let h = Hlc::new(n, 5_000);
        let change = Change::new(h, vec![]);
        let change_json = serde_json::to_string(&change).unwrap();

        let router = app().await;

        // POST
        let post_resp = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/changes")
                    .header("content-type", "application/json")
                    .body(Body::from(change_json))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_resp.status(), StatusCode::CREATED);

        // GET — should return [change]
        let get_resp = router
            .oneshot(Request::builder().uri("/v1/changes").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(get_resp.into_body(), usize::MAX).await.unwrap();
        let changes: Vec<Change> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].id, change.id);
    }

    // ── GET ?after=<cursor> ───────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn get_with_valid_cursor_filters_older_changes() {
        let n = node(1);
        let h1 = Hlc::new(n, 1_000);
        let h2 = h1.send(2_000);
        let h3 = h2.send(3_000);

        let c1 = Change::new(h1, vec![]);
        let c2 = Change::new(h2, vec![]);
        let c3 = Change::new(h3, vec![]);

        let router = app().await;

        for c in [&c1, &c2, &c3] {
            let body = serde_json::to_string(c).unwrap();
            router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/v1/changes")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        // Cursor at h1 → should return c2 and c3
        let cursor = h1.sort_key();
        let get_resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/changes?after={cursor}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(get_resp.into_body(), usize::MAX).await.unwrap();
        let changes: Vec<Change> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].id, c2.id);
        assert_eq!(changes[1].id, c3.id);
    }

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn get_with_invalid_cursor_returns_400() {
        let resp = app()
            .await
            .oneshot(
                Request::builder()
                    .uri("/v1/changes?after=not_a_cursor")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn post_duplicate_change_is_idempotent() {
        let n = node(1);
        let change = Change::new(Hlc::new(n, 1_000), vec![]);
        let body = serde_json::to_string(&change).unwrap();
        let router = app().await;

        // Insert twice
        for _ in 0..2_u8 {
            let resp = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/v1/changes")
                        .header("content-type", "application/json")
                        .body(Body::from(body.clone()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::CREATED);
        }

        // Should only appear once in GET
        let get_resp = router
            .oneshot(Request::builder().uri("/v1/changes").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(get_resp.into_body(), usize::MAX).await.unwrap();
        let changes: Vec<Change> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(changes.len(), 1);
    }

    // ── GET ?limit=<n> ────────────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::unwrap_used)]
    async fn get_with_limit_caps_results() {
        let n = node(1);
        let router = app().await;

        // Insert 5 changes
        let mut h = Hlc::new(n, 1_000);
        for _ in 0..5_u8 {
            let change = Change::new(h, vec![]);
            let body = serde_json::to_string(&change).unwrap();
            router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/v1/changes")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            h = h.send(h.millis() + 1);
        }

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/v1/changes?limit=2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let changes: Vec<Change> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(changes.len(), 2);
    }
}
