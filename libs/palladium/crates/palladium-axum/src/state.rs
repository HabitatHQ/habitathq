//! Shared application state threaded through axum handlers.

use std::sync::Arc;

use palladium_blobs::DynBlobStore;
use palladium_core::ChangeStore;

/// Shared state injected into every handler via [`axum::extract::State`].
///
/// `S` is the [`ChangeStore`] backend (e.g. `PostgresStore` or `SqliteStore`).
/// Wrapped in [`Arc`] so it can be cheaply cloned across handler calls.
pub struct AppState<S> {
    /// The backing change store.
    pub store: Arc<S>,
    /// Optional blob store. `None` means blob endpoints return 501.
    pub blob_store: Option<Arc<dyn DynBlobStore>>,
}

impl<S> AppState<S>
where
    S: ChangeStore + Send + Sync + 'static,
{
    /// Create a new [`AppState`] wrapping `store` with no blob store.
    pub fn new(store: S) -> Self {
        Self {
            store: Arc::new(store),
            blob_store: None,
        }
    }

    /// Attach a blob store to this state.
    ///
    /// Any type implementing [`palladium_blobs::BlobStore`] is accepted.
    #[must_use]
    pub fn with_blob_store(mut self, bs: impl palladium_blobs::BlobStore + 'static) -> Self {
        self.blob_store = Some(Arc::new(bs));
        self
    }
}

// axum requires State<T> to be Clone
impl<S> Clone for AppState<S> {
    fn clone(&self) -> Self {
        Self {
            store: Arc::clone(&self.store),
            blob_store: self.blob_store.clone(),
        }
    }
}
