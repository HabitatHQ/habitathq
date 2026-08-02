//! In-process HTTP tests for Phase 3a: identity, tenancy, and workspace
//! isolation on `/v1/changes`. Drives the real router via `tower::oneshot`.
#![cfg(test)]
#![allow(clippy::unwrap_used)]

use axum::{
    body::{to_bytes, Body},
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        Request, StatusCode,
    },
    Router,
};
use palladium_sqlite::SqliteStore;
use serde_json::{json, Value};
use tower::ServiceExt;
use tower_http::cors::CorsLayer;

use crate::{create_router, AtriumDb, AtriumState, DevBearerProvider};

async fn app() -> Router {
    let db = AtriumDb::in_memory().await.unwrap();
    let changes = SqliteStore::in_memory().await.unwrap();
    create_router(
        AtriumState::new(db, changes, DevBearerProvider),
        CorsLayer::permissive(),
    )
}

/// Fire one request; return the status and the parsed JSON body (Null if empty).
async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    workspace: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(t) = bearer {
        builder = builder.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    if let Some(w) = workspace {
        builder = builder.header("x-workspace", w);
    }
    if body.is_some() {
        builder = builder.header(CONTENT_TYPE, "application/json");
    }
    let req_body = body.map_or_else(Body::empty, |v| Body::from(v.to_string()));
    let resp = app.clone().oneshot(builder.body(req_body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

/// A minimal well-formed change (UUID ids, as the wire contract requires).
fn change() -> Value {
    let row = uuid::Uuid::new_v4();
    let node = uuid::Uuid::new_v4();
    json!({
        "id": uuid::Uuid::new_v4(),
        "hlc": { "wallMs": 1_700_000_000_000_u64, "counter": 0, "nodeId": node },
        "ops": [{ "op": "insert", "table": "tasks", "row_id": row,
                  "data": { "id": row, "text": "hi", "done": 0 } }],
    })
}

async fn create_workspace(app: &Router, user: &str) -> String {
    let (status, body) = call(app, "POST", "/v1/workspaces", Some(user), None, None).await;
    assert_eq!(status, StatusCode::OK);
    body["id"].as_str().unwrap().to_owned()
}

fn change_count(body: &Value) -> usize {
    body.as_array().map_or(0, Vec::len)
}

#[tokio::test]
async fn two_workspaces_are_isolated() {
    let app = app().await;
    let w1 = create_workspace(&app, "alice").await;
    let w2 = create_workspace(&app, "bob").await;

    let (post, _) = call(&app, "POST", "/v1/changes", Some("alice"), Some(&w1), Some(change())).await;
    assert_eq!(post, StatusCode::CREATED);

    let (_, alice_rows) = call(&app, "GET", "/v1/changes", Some("alice"), Some(&w1), None).await;
    assert_eq!(change_count(&alice_rows), 1);

    let (_, bob_rows) = call(&app, "GET", "/v1/changes", Some("bob"), Some(&w2), None).await;
    assert_eq!(change_count(&bob_rows), 0, "bob's workspace must not see alice's change");
}

#[tokio::test]
async fn non_member_is_forbidden() {
    let app = app().await;
    let w1 = create_workspace(&app, "alice").await;
    // bob is authenticated but not a member of w1.
    let (status, _) = call(&app, "GET", "/v1/changes", Some("bob"), Some(&w1), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (post, _) = call(&app, "POST", "/v1/changes", Some("bob"), Some(&w1), Some(change())).await;
    assert_eq!(post, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn invite_and_join_grants_access() {
    let app = app().await;
    let w1 = create_workspace(&app, "alice").await;

    let (status, invite) =
        call(&app, "POST", &format!("/v1/workspaces/{w1}/invites"), Some("alice"), None, None).await;
    assert_eq!(status, StatusCode::OK);
    let token = invite["token"].as_str().unwrap().to_owned();

    let (status, joined) =
        call(&app, "POST", &format!("/v1/invites/{token}/accept"), Some("bob"), None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(joined["workspace_id"].as_str(), Some(w1.as_str()));

    // bob can now read and write the shared workspace.
    let (post, _) = call(&app, "POST", "/v1/changes", Some("bob"), Some(&w1), Some(change())).await;
    assert_eq!(post, StatusCode::CREATED);
    let (_, rows) = call(&app, "GET", "/v1/changes", Some("alice"), Some(&w1), None).await;
    assert_eq!(change_count(&rows), 1, "alice sees bob's change in the shared workspace");

    // a re-used invite token is rejected.
    let (status, _) =
        call(&app, "POST", &format!("/v1/invites/{token}/accept"), Some("carol"), None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn missing_credentials_are_rejected() {
    let app = app().await;
    // no bearer → 401
    let (status, _) = call(&app, "GET", "/v1/changes", None, Some("w"), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(&app, "POST", "/v1/workspaces", None, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // authenticated but missing workspace header → 400
    let (status, _) = call(&app, "GET", "/v1/changes", Some("alice"), None, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
