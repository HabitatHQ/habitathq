//! Shared application state threaded through axum handlers.

use std::sync::Arc;

use palladium_blobs::DynBlobStore;
use palladium_core::ChangeStore;

use crate::auth::{Authenticator, Authorizer, Principal, StaticAuthenticator, StaticAuthorizer};

/// Shared application state injected into every handler.
pub struct AppState<S> {
    /// The backing change store.
    pub store: Arc<S>,
    /// Optional blob store.
    pub blob_store: Option<Arc<dyn DynBlobStore>>,
    /// Request authenticator.
    pub authenticator: Arc<dyn Authenticator>,
    /// Route-level authorizer.
    pub authorizer: Arc<dyn Authorizer>,
}

impl<S> AppState<S>
where
    S: ChangeStore + Send + Sync + 'static,
{
    /// Create state with permissive single-scope local defaults.
    pub fn new(store: S) -> Self {
        Self {
            store: Arc::new(store),
            blob_store: None,
            authenticator: Arc::new(StaticAuthenticator::new(Principal::new("default"))),
            authorizer: Arc::new(StaticAuthorizer::new(palladium_core::Scope::new("default"))),
        }
    }
    /// Attach a blob store.
    #[must_use]
    pub fn with_blob_store(mut self, bs: impl palladium_blobs::BlobStore + 'static) -> Self {
        self.blob_store = Some(Arc::new(bs));
        self
    }
    /// Replace request authentication.
    #[must_use]
    pub fn with_authenticator(mut self, authenticator: impl Authenticator) -> Self {
        self.authenticator = Arc::new(authenticator);
        self
    }
    /// Replace route authorization.
    #[must_use]
    pub fn with_authorizer(mut self, authorizer: impl Authorizer) -> Self {
        self.authorizer = Arc::new(authorizer);
        self
    }
}

impl<S> Clone for AppState<S> {
    fn clone(&self) -> Self {
        Self {
            store: Arc::clone(&self.store),
            blob_store: self.blob_store.clone(),
            authenticator: Arc::clone(&self.authenticator),
            authorizer: Arc::clone(&self.authorizer),
        }
    }
}
