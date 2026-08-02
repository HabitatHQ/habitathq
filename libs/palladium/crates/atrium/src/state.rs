//! Shared state threaded through Atrium's axum handlers.

use std::sync::Arc;

use palladium_sqlite::SqliteStore;

use crate::{db::AtriumDb, identity::IdentityProvider};

/// State injected into every handler via [`axum::extract::State`].
///
/// Holds Atrium's tenancy DB, the embedded Palladium change store, and the
/// identity provider. Cheap to clone (all fields are [`Arc`]s).
#[derive(Clone)]
pub struct AtriumState {
    db: Arc<AtriumDb>,
    changes: Arc<SqliteStore>,
    identity: Arc<dyn IdentityProvider>,
}

impl AtriumState {
    /// Assemble state from a tenancy DB, a change store, and an identity provider.
    #[must_use]
    pub fn new(db: AtriumDb, changes: SqliteStore, identity: impl IdentityProvider) -> Self {
        Self {
            db: Arc::new(db),
            changes: Arc::new(changes),
            identity: Arc::new(identity),
        }
    }

    /// The tenancy database.
    #[must_use]
    pub fn db(&self) -> &AtriumDb {
        &self.db
    }

    /// The embedded Palladium change store.
    #[must_use]
    pub fn changes(&self) -> &SqliteStore {
        &self.changes
    }

    /// The identity provider (used by the `Caller` extractor).
    #[must_use]
    pub fn identity(&self) -> &dyn IdentityProvider {
        self.identity.as_ref()
    }
}
