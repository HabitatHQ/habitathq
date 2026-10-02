//! Workspace-scoped change proxy with record-level ACL.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use palladium_core::Change;
use serde::{Deserialize, Serialize};

use crate::{
    db::{AppendOutcome, AtriumDb, PendingEvent, EVENT_GRANT, EVENT_REVOKE},
    error::AtriumError,
    identity::Caller,
    state::AtriumState,
};

const WORKSPACE_HEADER: &str = "x-workspace";
const NODE_HEADER: &str = "x-palladium-node";
const GRANT_SCAN_BATCH: u32 = 100;

fn workspace_of(headers: &HeaderMap) -> Result<String, AtriumError> {
    headers
        .get(WORKSPACE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AtriumError::BadRequest(format!("missing {WORKSPACE_HEADER} header")))
}

fn node_of(headers: &HeaderMap) -> Result<String, AtriumError> {
    let value = headers
        .get(NODE_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AtriumError::BadRequest(format!("missing {NODE_HEADER} header")))?;
    let node = uuid::Uuid::parse_str(value)
        .map_err(|_| AtriumError::BadRequest(format!("invalid {NODE_HEADER} header")))?;
    if node.get_version() != Some(uuid::Version::Random) || value != node.to_string() {
        return Err(AtriumError::BadRequest(format!(
            "invalid {NODE_HEADER} header"
        )));
    }
    Ok(node.to_string())
}

fn parse_append_cursor(value: &str) -> Result<i64, AtriumError> {
    if value == "0" {
        return Ok(0);
    }
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(AtriumError::BadRequest("invalid_cursor".to_owned()));
    }
    value
        .parse::<i64>()
        .map_err(|_| AtriumError::BadRequest("invalid_cursor".to_owned()))
}

#[derive(Debug, Deserialize)]
pub(super) struct ListQuery {
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
struct PageControl {
    #[serde(rename = "mustRefetch")]
    must_refetch: bool,
}

#[derive(Debug, Serialize)]
struct PagePurge {
    table: String,
    row_id: String,
}

#[derive(Debug, Serialize)]
pub(super) struct PostReceipt {
    version: u8,
    outcome: &'static str,
    cursor: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct AckRequest {
    pub event_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub(super) struct ChangesResponse {
    version: u8,
    changes: Vec<Change>,
    cursor: String,
    #[serde(rename = "upperBound")]
    upper_bound: String,
    purges: Vec<PagePurge>,
    events: Vec<PendingEvent>,
    control: PageControl,
    #[serde(rename = "caughtUp")]
    caught_up: bool,
}

async fn change_root(
    db: &AtriumDb,
    workspace: &str,
    change: &Change,
) -> Result<Option<String>, AtriumError> {
    let Some(first) = change.ops.first() else {
        return Ok(None);
    };
    Ok(db
        .effective_root(workspace, &first.row_id().to_string())
        .await?
        .map(|root| root.row_id))
}

async fn change_visible(
    db: &AtriumDb,
    workspace: &str,
    caller: &str,
    change: &Change,
) -> Result<bool, AtriumError> {
    if change.ops.is_empty() {
        return Ok(false);
    }
    for op in &change.ops {
        if !db
            .can_read(workspace, caller, &op.row_id().to_string())
            .await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn get_clock(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
) -> Result<Json<palladium_core::ClockResponse>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    let now_millis = state.now_millis().map_err(AtriumError::internal)?;
    Ok(Json(palladium_core::ClockResponse::v1(now_millis)))
}

pub(super) async fn post_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<(StatusCode, Json<PostReceipt>), AtriumError> {
    let workspace = workspace_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    let now_millis = state.now_millis().map_err(AtriumError::internal)?;
    let outcome = state
        .db()
        .authorize_and_append_change(&workspace, user.as_str(), &change, now_millis)
        .await?;
    let (outcome, cursor) = match outcome {
        AppendOutcome::Inserted(cursor) => ("inserted", cursor),
        AppendOutcome::Duplicate(cursor) => ("duplicate", cursor),
    };
    Ok((
        StatusCode::CREATED,
        Json(PostReceipt {
            version: 1,
            outcome,
            cursor: cursor.to_string(),
        }),
    ))
}

async fn append_grant_backfills(
    db: &AtriumDb,
    workspace: &str,
    user: &str,
    node_id: &str,
    events: &[PendingEvent],
    changes: &mut Vec<Change>,
    limit: u32,
) -> Result<bool, AtriumError> {
    let mut all_caught_up = true;
    let mut remaining = usize::try_from(limit)
        .unwrap_or(100)
        .saturating_sub(changes.len());
    let mut scan_remaining = GRANT_SCAN_BATCH;
    for event in events.iter().filter(|event| event.kind == EVENT_GRANT) {
        if scan_remaining == 0 || remaining == 0 {
            all_caught_up = false;
            break;
        }
        let Some((root, offered, offered_upper, _offered_complete, backfill_cursor)) = db
            .grant_offer_state(workspace, user, node_id, event.id)
            .await?
        else {
            continue;
        };
        if !db.can_read(workspace, user, &root).await? {
            continue;
        }
        let (after, bound, scan_through) = if let Some(through) = offered {
            (backfill_cursor, offered_upper.unwrap_or(through), through)
        } else {
            let bound = match offered_upper {
                Some(bound) => bound,
                None => db.workspace_append_bound(workspace).await?,
            };
            (backfill_cursor, bound, bound)
        };
        let entries = db
            .list_change_batch_through(workspace, after, scan_through, scan_remaining)
            .await?;
        scan_remaining -= u32::try_from(entries.len()).unwrap_or(scan_remaining);
        let scanned_through = entries
            .last()
            .map_or(scan_through, |entry| entry.append_seq);
        let mut selected = Vec::new();
        let mut selected_through = after;
        for entry in entries {
            let is_root =
                change_root(db, workspace, &entry.change).await?.as_deref() == Some(root.as_str());
            if is_root && selected.len() < remaining {
                selected_through = entry.append_seq;
                selected.push(entry);
            }
        }
        // Do not skip matching rows scanned beyond the response capacity. They
        // remain in the raw history and will be considered after this offer is ACKed.
        let through = if selected.len() == remaining && remaining > 0 {
            selected_through
        } else {
            scanned_through
        };
        let complete = through >= bound;
        db.grant_offer(event.id, through, bound, complete).await?;
        let candidates = selected;
        all_caught_up &= complete;
        for entry in candidates {
            if remaining == 0 {
                break;
            }
            if changes
                .iter()
                .any(|existing| existing.id == entry.change.id)
            {
                continue;
            }
            if !db.can_read(workspace, user, &root).await? {
                break;
            }
            if change_root(db, workspace, &entry.change).await?.as_deref() == Some(root.as_str()) {
                changes.push(entry.change);
                remaining -= 1;
            }
        }
    }
    Ok(all_caught_up)
}

pub(super) async fn get_changes(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Query(params): Query<ListQuery>,
) -> Result<Json<ChangesResponse>, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let node_id = node_of(&headers)?;
    let db = state.db();
    db.require_member(&workspace, user.as_str()).await?;
    db.register_member_node(&workspace, user.as_str(), &node_id)
        .await?;
    let after = match params.cursor.as_deref() {
        None => 0,
        Some(value) => parse_append_cursor(value)?,
    };
    let limit = params.limit.unwrap_or(100);
    if !(1..=100).contains(&limit) {
        return Err(AtriumError::BadRequest("invalid_request".to_owned()));
    }
    let upper_bound = db.workspace_append_bound(&workspace).await?;
    if after > upper_bound {
        return Err(AtriumError::BadRequest("invalid_cursor".to_owned()));
    }
    let history = db
        .list_change_batch_through(&workspace, after, upper_bound, limit)
        .await?;
    let raw_count = history.len();
    let cursor = history
        .last()
        .map_or(after, |entry| entry.append_seq)
        .to_string();
    let mut changes = Vec::new();
    for entry in history {
        let change = entry.change;
        if change_visible(db, &workspace, user.as_str(), &change).await? {
            changes.push(change);
        }
    }
    let events = db
        .pending_events(&workspace, user.as_str(), &node_id)
        .await?;
    let backfills_caught_up = append_grant_backfills(
        db,
        &workspace,
        user.as_str(),
        &node_id,
        &events,
        &mut changes,
        limit,
    )
    .await?;
    let mut purges = Vec::new();
    for event in events.iter().filter(|event| event.kind == EVENT_REVOKE) {
        let records = db.records_for_root(&workspace, &event.root_id).await?;
        if records.is_empty() {
            return Err(AtriumError::NotFound(format!(
                "purge root {}",
                event.root_id
            )));
        }
        purges.extend(records.into_iter().map(|record| PagePurge {
            table: record.table_name,
            row_id: record.row_id,
        }));
    }
    purges.sort_by(|a, b| a.table.cmp(&b.table).then(a.row_id.cmp(&b.row_id)));
    purges.dedup_by(|a, b| a.table == b.table && a.row_id == b.row_id);
    Ok(Json(ChangesResponse {
        version: 1,
        changes,
        cursor: cursor.clone(),
        upper_bound: upper_bound.to_string(),
        purges,
        events,
        control: PageControl {
            must_refetch: false,
        },
        caught_up: raw_count < usize::try_from(limit).unwrap_or(100) && backfills_caught_up,
    }))
}

/// Acknowledge pending event ids for the authenticated caller and workspace.
pub(super) async fn acknowledge_events(
    State(state): State<AtriumState>,
    Caller(user): Caller,
    headers: HeaderMap,
    Json(req): Json<AckRequest>,
) -> Result<StatusCode, AtriumError> {
    let workspace = workspace_of(&headers)?;
    let node_id = node_of(&headers)?;
    state.db().require_member(&workspace, user.as_str()).await?;
    state
        .db()
        .register_member_node(&workspace, user.as_str(), &node_id)
        .await?;
    state
        .db()
        .acknowledge_events(&workspace, user.as_str(), &node_id, &req.event_ids)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
