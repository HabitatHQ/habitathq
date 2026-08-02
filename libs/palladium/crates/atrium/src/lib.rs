//! Atrium — the `HabitatHQ` ecosystem backend.
//!
//! Atrium sits in front of Palladium's generic change store and adds the
//! application concerns Palladium deliberately does not know about: identity,
//! tenancy/membership, and (Phase 3b) record-level ACL. It embeds
//! `palladium-sqlite`'s change store as a library and exposes its own
//! client-facing HTTP surface.
//!
//! Phase 3a implements identity ([`DevBearerProvider`]), tenancy
//! ([`AtriumDb`]), and a workspace-scoped `/v1/changes` proxy.

mod routes;

#[cfg(test)]
mod http_tests;

pub mod db;
pub mod error;
pub mod identity;
pub mod state;

pub use db::AtriumDb;
pub use error::AtriumError;
pub use identity::{Caller, DevBearerProvider, IdentityProvider, UserId};
pub use routes::create_router;
pub use state::AtriumState;
