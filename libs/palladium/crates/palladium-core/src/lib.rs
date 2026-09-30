//! `palladium-core` — primitives, types, and the delta model for the
//! Palladium local-first sync engine.
//!
//! # Architecture
//!
//! ```text
//! NodeId   — identifies a sync participant (device / client / server)
//! Hlc      — Hybrid Logical Clock for causal ordering of events
//! Op       — a single row-level change (Insert | Update | Delete)
//! Change   — an atomic, HLC-stamped batch of Ops
//! ```
//!
//! Higher-level crates (`palladium-axum`, `palladium-postgres`, …) build on
//! these primitives to provide transport, storage, and framework integrations.

use std::collections::HashMap;

mod change;
mod config;
mod error;
mod hlc;
mod instance_config;
mod instance_registry;
mod instance_status;
mod node_id;
mod op;
mod scope;
mod store;

pub use change::Change;
pub use config::ServerConfig;
pub use error::Error;
pub use hlc::Hlc;
pub use instance_config::{
    BackendKind, InstanceConfig, InstanceLimits, PostgresInstanceOptions, PostgresIsolation,
};
pub use instance_registry::{register, OpenGuard};
pub use instance_status::{GlobalHealthResponse, InstanceStatus};
pub use node_id::NodeId;
pub use op::Op;
pub use scope::Scope;
pub use store::{
    AppendCursor, ChangePage, ChangeStore, InsertOutcome, PageControl, PagePurge, MAX_PAGE_SIZE,
};

/// Maximum permitted HLC wall-clock skew for v1 replicated changes.
pub const V1_MAX_FUTURE_HLC_MILLIS: u64 = 300_000;

/// Validate a v1 replicated change against the current Unix time.
///
/// # Errors
///
/// Returns `clock_skew` when the local clock cannot be read or the HLC exceeds
/// the permitted future offset. It also rejects non-v4 change and node IDs,
/// empty changes, non-v7 row IDs, and non-canonical operation sequences.
pub fn validate_v1_change(change: &Change) -> std::result::Result<(), String> {
    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock_skew".to_owned())
        .and_then(|duration| {
            u64::try_from(duration.as_millis()).map_err(|_| "clock_skew".to_owned())
        })?;
    validate_change(change, now_millis, V1_MAX_FUTURE_HLC_MILLIS)
}

/// Returns `clock_skew` when the HLC exceeds the permitted future offset. It
/// also rejects non-v4 change and node IDs, empty changes, non-v7 row IDs, and
/// non-canonical operation sequences.
///
/// # Errors
///
/// Returns a stable validation error code when any v1 identity, timestamp, row
/// ID, or canonical-operation invariant is violated.
pub fn validate_change(
    change: &Change,
    now_millis: u64,
    max_future_millis: u64,
) -> std::result::Result<(), String> {
    if change.id.get_version() != Some(uuid::Version::Random) {
        return Err(format!("change id {} is not UUIDv4", change.id));
    }
    if change.hlc.node_id().as_uuid().get_version() != Some(uuid::Version::Random) {
        return Err(format!(
            "HLC node id {} is not UUIDv4",
            change.hlc.node_id()
        ));
    }
    if change.hlc.millis() > now_millis.saturating_add(max_future_millis) {
        return Err("clock_skew".to_owned());
    }
    if change.ops.is_empty() {
        return Err("change has no operations".to_owned());
    }
    let mut operation_states = HashMap::new();
    for op in &change.ops {
        if op.row_id().get_version() != Some(uuid::Version::SortRand) {
            return Err(format!("row id {} is not UUIDv7", op.row_id()));
        }
        let key = (op.table(), op.row_id());
        match op {
            Op::Insert { .. } | Op::Delete { .. } => {
                if operation_states.insert(key, None).is_some() {
                    return Err("change is not canonical".to_owned());
                }
            }
            Op::Update { col, .. } => match operation_states.get_mut(&key) {
                None => {
                    operation_states.insert(key, Some(vec![col.as_str()]));
                }
                Some(None) => return Err("change is not canonical".to_owned()),
                Some(Some(columns)) if columns.contains(&col.as_str()) => {
                    return Err("change is not canonical".to_owned());
                }
                Some(Some(columns)) => columns.push(col),
            },
        }
    }
    Ok(())
}

/// Canonical payload bytes used for scoped idempotency checks.
///
/// # Errors
///
/// Returns a serialization error when the change cannot be encoded as JSON.
pub fn canonical_change_bytes(change: &Change) -> std::result::Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(change)
}

/// Convenience `Result` alias using [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
