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
/// the permitted future offset, or an error when any replicated row identifier
/// is not `UUIDv7`.
pub fn validate_v1_change(change: &Change) -> std::result::Result<(), String> {
    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock_skew".to_owned())
        .and_then(|duration| {
            u64::try_from(duration.as_millis()).map_err(|_| "clock_skew".to_owned())
        })?;
    validate_change(change, now_millis, V1_MAX_FUTURE_HLC_MILLIS)
}

/// Validate a replicated change at a protocol boundary.
///
/// # Errors
///
/// Returns `clock_skew` when the HLC exceeds the permitted future offset, or
/// an error when any replicated row identifier is not `UUIDv7`.
pub fn validate_change(
    change: &Change,
    now_millis: u64,
    max_future_millis: u64,
) -> std::result::Result<(), String> {
    if change.hlc.millis() > now_millis.saturating_add(max_future_millis) {
        return Err("clock_skew".to_owned());
    }
    for op in &change.ops {
        if op.row_id().get_version() != Some(uuid::Version::SortRand) {
            return Err(format!("row id {} is not UUIDv7", op.row_id()));
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
