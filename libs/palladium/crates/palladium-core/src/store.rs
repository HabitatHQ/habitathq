//! Abstract storage interface for [`Change`]s.
//!
//! [`ChangeStore`] is the only interface that higher-level crates depend on.
//! Concrete implementations live in `palladium-sqlite` and
//! `palladium-postgres`.

use std::future::Future;

use uuid::Uuid;

use crate::{Change, Hlc, Scope};

/// Persistence layer for [`Change`]s.
///
/// Implementors provide either local embedded storage (`SQLite` via
/// `palladium-sqlite`) or server-side storage (`PostgreSQL` via
/// `palladium-postgres`). Handlers in `palladium-axum` are generic over any
/// `ChangeStore`.
pub trait ChangeStore {
    /// The error type returned by store operations.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Persist a change within `scope`. Duplicate inserts (same `id`) are
    /// silently ignored. `scope` is opaque — the store only partitions by it.
    ///
    /// # Errors
    /// Returns an error if the storage operation fails.
    fn insert<'a>(
        &'a self,
        scope: &'a Scope,
        change: &'a Change,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'a;

    /// Return changes **in `scope`** whose HLC is strictly after `after`,
    /// ordered by HLC. If `after` is `None`, returns from the beginning.
    /// If `limit` is `Some(n)`, returns at most `n` changes. Changes in other
    /// scopes are never returned.
    ///
    /// # Errors
    /// Returns an error if the query fails.
    fn list_after<'a>(
        &'a self,
        scope: &'a Scope,
        after: Option<Hlc>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<Vec<Change>, Self::Error>> + Send + 'a;

    /// Retrieve a single change by its ID **within `scope`** (a change stored
    /// under a different scope is invisible).
    ///
    /// # Errors
    /// Returns an error if the query fails.
    fn get<'a>(
        &'a self,
        scope: &'a Scope,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Change>, Self::Error>> + Send + 'a;
}
