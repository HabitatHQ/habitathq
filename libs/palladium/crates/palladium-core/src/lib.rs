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
pub use store::ChangeStore;

/// Convenience `Result` alias using [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
