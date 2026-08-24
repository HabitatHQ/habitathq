// Atrium's state is a binary-internal test seam, not a consumer-facing library API.
#![allow(missing_docs, reason = "Atrium internal state API")]
//! Shared state threaded through Atrium's axum handlers.

use std::sync::Arc;

use crate::{db::AtriumDb, identity::IdentityProvider};

/// State injected into every handler via [`axum::extract::State`].
#[derive(Clone)]
pub struct AtriumState {
    db: Arc<AtriumDb>,
    identity: Arc<dyn IdentityProvider>,
}

impl AtriumState {
    /// Assemble state from the unified Atrium database and identity provider.
    #[must_use]
    pub fn new(db: AtriumDb, identity: impl IdentityProvider) -> Self {
        Self {
            db: Arc::new(db),
            identity: Arc::new(identity),
        }
    }

    #[must_use]
    pub fn db(&self) -> &AtriumDb {
        &self.db
    }

    #[must_use]
    pub fn identity(&self) -> &dyn IdentityProvider {
        self.identity.as_ref()
    }
}
