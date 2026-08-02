//! In-process HTTP tests: tenancy isolation (3a) + the record-level ACL
//! acceptance matrix A1–A8 (3b). Drives the real router via `tower::oneshot`.
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
use uuid::Uuid;

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

// ── change / request builders ───────────────────────────────────────────────

fn wrap(ops: &Value) -> Value {
    json!({
        "id": Uuid::new_v4(),
        "hlc": { "wallMs": 1_700_000_000_000_u64, "counter": 0, "nodeId": Uuid::new_v4() },
        "ops": ops.clone(),
    })
}

fn root_insert(table: &str) -> (Uuid, Value) {
    let row = Uuid::new_v4();
    (row, wrap(&json!([{ "op": "insert", "table": table, "row_id": row, "data": { "id": row } }])))
}

fn child_insert(table: &str, root: Uuid) -> (Uuid, Value) {
    let row = Uuid::new_v4();
    let data = json!({ "id": row, "root_id": root });
    (row, wrap(&json!([{ "op": "insert", "table": table, "row_id": row, "data": data }])))
}

fn update(table: &str, row: Uuid) -> Value {
    wrap(&json!([{ "op": "update", "table": table, "row_id": row, "col": "x", "value": 1 }]))
}

// ── high-level helpers ──────────────────────────────────────────────────────

async fn create_workspace(app: &Router, user: &str) -> String {
    let (status, body) = call(app, "POST", "/v1/workspaces", Some(user), None, None).await;
    assert_eq!(status, StatusCode::OK);
    body["id"].as_str().unwrap().to_owned()
}

/// A workspace owned by `alice` with `bob` and `carol` as members.
async fn family(app: &Router) -> String {
    let ws = create_workspace(app, "alice").await;
    for member in ["bob", "carol"] {
        let (_, invite) =
            call(app, "POST", &format!("/v1/workspaces/{ws}/invites"), Some("alice"), None, None).await;
        let token = invite["token"].as_str().unwrap().to_owned();
        let (status, _) =
            call(app, "POST", &format!("/v1/invites/{token}/accept"), Some(member), None, None).await;
        assert_eq!(status, StatusCode::OK);
    }
    ws
}

async fn post_change(app: &Router, user: &str, ws: &str, change: Value) -> StatusCode {
    call(app, "POST", "/v1/changes", Some(user), Some(ws), Some(change)).await.0
}

async fn get_env(app: &Router, user: &str, ws: &str) -> Value {
    call(app, "GET", "/v1/changes", Some(user), Some(ws), None).await.1
}

async fn share(app: &Router, owner: &str, root: Uuid, grantee: &str, perm: &str) -> StatusCode {
    let body = json!({ "root_id": root, "grantee_user_id": grantee, "perm": perm });
    call(app, "POST", "/v1/shares", Some(owner), None, Some(body)).await.0
}

async fn unshare(app: &Router, owner: &str, root: Uuid, grantee: &str) -> StatusCode {
    let body = json!({ "root_id": root, "grantee_user_id": grantee });
    call(app, "DELETE", "/v1/shares", Some(owner), None, Some(body)).await.0
}

async fn set_sharing(app: &Router, owner: &str, root: Uuid, class: &str) -> StatusCode {
    let body = json!({ "class": class });
    call(app, "PATCH", &format!("/v1/records/{root}/sharing"), Some(owner), None, Some(body)).await.0
}

/// Whether the envelope's `changes` contain any op targeting `row`.
fn sees(env: &Value, row: Uuid) -> bool {
    let target = row.to_string();
    env["changes"].as_array().is_some_and(|changes| {
        changes.iter().any(|c| {
            c["ops"]
                .as_array()
                .is_some_and(|ops| ops.iter().any(|o| o["row_id"].as_str() == Some(target.as_str())))
        })
    })
}

/// Whether the envelope tells the caller to purge `root`.
fn purged(env: &Value, root: Uuid) -> bool {
    let target = root.to_string();
    env["purges"]
        .as_array()
        .is_some_and(|p| p.iter().any(|v| v.as_str() == Some(target.as_str())))
}

// ── tenancy isolation (Phase 3a) ────────────────────────────────────────────

#[tokio::test]
async fn two_workspaces_are_isolated() {
    let app = app().await;
    let w1 = create_workspace(&app, "alice").await;
    let w2 = create_workspace(&app, "bob").await;
    let (habit, change) = root_insert("habits");
    assert_eq!(post_change(&app, "alice", &w1, change).await, StatusCode::CREATED);
    assert!(sees(&get_env(&app, "alice", &w1).await, habit));
    assert!(!sees(&get_env(&app, "bob", &w2).await, habit));
}

#[tokio::test]
async fn non_member_is_forbidden() {
    let app = app().await;
    let w1 = create_workspace(&app, "alice").await;
    let (status, _) = call(&app, "GET", "/v1/changes", Some("bob"), Some(&w1), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn missing_credentials_are_rejected() {
    let app = app().await;
    assert_eq!(call(&app, "GET", "/v1/changes", None, Some("w"), None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(call(&app, "POST", "/v1/workspaces", None, None, None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(call(&app, "GET", "/v1/changes", Some("alice"), None, None).await.0, StatusCode::BAD_REQUEST);
}

// ── record-level ACL acceptance matrix (Phase 3b, §7.1) ─────────────────────

#[tokio::test]
async fn a1_private_floor_and_child_cascade() {
    let app = app().await;
    let ws = family(&app).await;
    let (habit, ch) = root_insert("habits");
    assert_eq!(post_change(&app, "alice", &ws, ch).await, StatusCode::CREATED);
    let (comp, ch2) = child_insert("completions", habit);
    assert_eq!(post_change(&app, "alice", &ws, ch2).await, StatusCode::CREATED);

    let alice = get_env(&app, "alice", &ws).await;
    assert!(sees(&alice, habit) && sees(&alice, comp), "owner sees her own");
    let bob = get_env(&app, "bob", &ws).await;
    assert!(!sees(&bob, habit), "a private habit never reaches another member");
    assert!(!sees(&bob, comp), "nor its private child completion");
}

#[tokio::test]
async fn a2_household_grant_includes_children() {
    let app = app().await;
    let ws = family(&app).await;
    let (list, ch) = root_insert("lists");
    post_change(&app, "alice", &ws, ch).await;
    let (item, ch2) = child_insert("list_items", list);
    post_change(&app, "alice", &ws, ch2).await;

    assert!(!sees(&get_env(&app, "bob", &ws).await, list), "private before sharing");
    assert_eq!(set_sharing(&app, "alice", list, "household_read").await, StatusCode::OK);
    let bob = get_env(&app, "bob", &ws).await;
    assert!(sees(&bob, list), "household grant backfills the list");
    assert!(sees(&bob, item), "and its items ride along (child inheritance)");
}

#[tokio::test]
async fn a3_downgrade_rejects_member_writes() {
    let app = app().await;
    let ws = family(&app).await;
    let (list, ch) = root_insert("lists");
    post_change(&app, "alice", &ws, ch).await;
    let (item, ch2) = child_insert("list_items", list);
    post_change(&app, "alice", &ws, ch2).await;

    assert_eq!(set_sharing(&app, "alice", list, "household_rw").await, StatusCode::OK);
    assert_eq!(
        post_change(&app, "bob", &ws, update("list_items", item)).await,
        StatusCode::CREATED,
        "read-write household member may write"
    );
    assert_eq!(set_sharing(&app, "alice", list, "household_read").await, StatusCode::OK);
    assert_eq!(
        post_change(&app, "bob", &ws, update("list_items", item)).await,
        StatusCode::FORBIDDEN,
        "after downgrade to read, the member's write is rejected"
    );
}

#[tokio::test]
async fn a4_per_member_grant_and_backfill() {
    let app = app().await;
    let ws = family(&app).await;
    let (note, ch) = root_insert("notes");
    post_change(&app, "alice", &ws, ch).await;
    assert_eq!(share(&app, "alice", note, "bob", "read").await, StatusCode::OK);

    assert!(sees(&get_env(&app, "bob", &ws).await, note), "grantee backfills the note");
    assert!(!sees(&get_env(&app, "carol", &ws).await, note), "a non-grantee never sees it");
}

#[tokio::test]
async fn a5_revoke_purges() {
    let app = app().await;
    let ws = family(&app).await;
    let (note, ch) = root_insert("notes");
    post_change(&app, "alice", &ws, ch).await;
    share(&app, "alice", note, "bob", "read").await;
    let _ = get_env(&app, "bob", &ws).await; // bob consumes the grant

    assert_eq!(unshare(&app, "alice", note, "bob").await, StatusCode::OK);
    assert!(purged(&get_env(&app, "bob", &ws).await, note), "revoke tells bob to purge the note");
}

#[tokio::test]
async fn a6_offline_write_after_revoke_rejected() {
    let app = app().await;
    let ws = family(&app).await;
    let (note, ch) = root_insert("notes");
    post_change(&app, "alice", &ws, ch).await;
    share(&app, "alice", note, "bob", "write").await;
    assert_eq!(
        post_change(&app, "bob", &ws, update("notes", note)).await,
        StatusCode::CREATED,
        "bob may write while granted"
    );

    unshare(&app, "alice", note, "bob").await;
    assert_eq!(
        post_change(&app, "bob", &ws, update("notes", note)).await,
        StatusCode::FORBIDDEN,
        "a write after revoke is rejected"
    );
}

#[tokio::test]
async fn a8_anti_forgery() {
    let app = app().await;
    let ws = family(&app).await;
    let (habit, ch) = root_insert("habits");
    post_change(&app, "alice", &ws, ch).await;

    // a member cannot write another member's private record …
    assert_eq!(
        post_change(&app, "bob", &ws, update("habits", habit)).await,
        StatusCode::FORBIDDEN
    );
    // … nor re-insert its id to forge ownership …
    let forged = wrap(&json!([{ "op": "insert", "table": "habits", "row_id": habit, "data": { "id": habit } }]));
    assert_eq!(post_change(&app, "bob", &ws, forged).await, StatusCode::FORBIDDEN);
    // … nor share a record they do not own.
    let (note, ch2) = root_insert("notes");
    post_change(&app, "alice", &ws, ch2).await;
    assert_eq!(share(&app, "bob", note, "carol", "read").await, StatusCode::FORBIDDEN);
}
