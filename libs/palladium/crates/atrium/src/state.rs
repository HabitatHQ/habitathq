// Atrium's state is a binary-internal test seam, not a consumer-facing library API.
#![allow(missing_docs, reason = "Atrium internal state API")]
//! Shared state threaded through Atrium's axum handlers.

use std::sync::Arc;

use palladium_core::{ServerClock, SystemClock};

use crate::{db::AtriumDb, identity::IdentityProvider};

/// State injected into every handler via [`axum::extract::State`].
#[derive(Clone)]
pub struct AtriumState {
    db: Arc<AtriumDb>,
    identity: Arc<dyn IdentityProvider>,
    clock: Arc<dyn ServerClock>,
}

impl AtriumState {
    /// Assemble state from the unified Atrium database and identity provider.
    #[must_use]
    pub fn new(db: AtriumDb, identity: impl IdentityProvider) -> Self {
        Self {
            db: Arc::new(db),
            identity: Arc::new(identity),
            clock: Arc::new(SystemClock),
        }
    }

    /// Replace the authoritative clock, including deterministic integration clocks.
    #[must_use]
    pub fn with_clock(mut self, clock: impl ServerClock) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    /// Read the authoritative server time used for fresh-change admission.
    ///
    /// # Errors
    ///
    /// Returns an error if the configured clock cannot provide a valid Unix timestamp.
    pub fn now_millis(&self) -> Result<u64, palladium_core::ClockError> {
        self.clock.now_millis()
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
