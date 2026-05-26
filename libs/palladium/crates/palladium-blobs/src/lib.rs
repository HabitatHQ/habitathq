//! `palladium-blobs` — Binary large object storage for the Palladium sync engine.
//!
//! Provides [`BlobRef`], [`BlobStore`], and [`BlobError`] types for storing and
//! retrieving opaque binary blobs referenced from [`Op`] data fields.
//!
//! [`Op`]: palladium_core::Op

mod error;
pub mod filesystem;
pub mod metadata;
pub mod column_meta;

pub use error::BlobError;

use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Opaque identifier for a stored blob.
pub type BlobId = Uuid;

/// A compact reference to a stored blob, suitable for embedding in [`Op`] data.
///
/// Stored as a JSON string in the column value via [`BlobRef::to_column_value`]
/// and [`BlobRef::from_column_value`].
///
/// [`Op`]: palladium_core::Op
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobRef {
    /// The unique identifier of the stored blob.
    pub blob_id: BlobId,
    /// The size of the blob in bytes.
    pub size_bytes: u64,
    /// The MIME type of the blob (e.g. `"image/png"`).
    pub mime: String,
}

impl BlobRef {
    /// Serialise this reference to a JSON string suitable for storing in an Op
    /// data column.
    ///
    /// # Panics
    ///
    /// Cannot panic in practice: `BlobRef` contains only primitive and `String`
    /// fields, so serialisation is infallible.
    #[must_use]
    pub fn to_column_value(&self) -> String {
        // BlobRef fields are all trivially serialisable — this cannot fail.
        #[allow(clippy::expect_used)]
        serde_json::to_string(self).expect("BlobRef serialisation is infallible")
    }

    /// Deserialise a [`BlobRef`] from a JSON column value produced by
    /// [`to_column_value`](Self::to_column_value).
    ///
    /// # Errors
    ///
    /// Returns [`BlobError::Serialization`] if `s` is not valid JSON or does not
    /// match the [`BlobRef`] schema.
    pub fn from_column_value(s: &str) -> Result<Self, BlobError> {
        serde_json::from_str(s).map_err(BlobError::Serialization)
    }
}

impl fmt::Display for BlobRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.blob_id)
    }
}

/// Async trait for blob storage backends.
///
/// Implementors must be `Send + Sync` so they can be shared across async tasks.
/// The default implementation of [`presigned_get_url`](Self::presigned_get_url)
/// returns `None`; only S3-compatible backends override it.
pub trait BlobStore: Send + Sync {
    /// Store `data` under `id`.
    ///
    /// # Errors
    ///
    /// Returns an error if the write fails.
    fn put(
        &self,
        id: BlobId,
        data: &[u8],
    ) -> impl std::future::Future<Output = Result<(), BlobError>> + Send;

    /// Retrieve the bytes stored under `id`.
    ///
    /// # Errors
    ///
    /// Returns [`BlobError::NotFound`] if the blob does not exist (or has been
    /// soft-deleted). Returns other errors on I/O failure.
    fn get(
        &self,
        id: BlobId,
    ) -> impl std::future::Future<Output = Result<Vec<u8>, BlobError>> + Send;

    /// Soft-delete the blob with `id`.
    ///
    /// The backing bytes are not immediately removed; call `purge_expired` to
    /// reclaim storage.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    fn delete(
        &self,
        id: BlobId,
    ) -> impl std::future::Future<Output = Result<(), BlobError>> + Send;

    /// Returns `true` if a blob with `id` exists and has not been soft-deleted.
    ///
    /// # Errors
    ///
    /// Returns an error on I/O failure.
    fn exists(
        &self,
        id: BlobId,
    ) -> impl std::future::Future<Output = Result<bool, BlobError>> + Send;

    /// Return a pre-signed URL for direct client download, if the backend
    /// supports it. Returns `None` by default.
    fn presigned_get_url(&self, _id: BlobId, _expires_secs: u64) -> Option<String> {
        None
    }
}

/// Object-safe version of [`BlobStore`] that uses boxed futures.
///
/// This is the type-erased interface used for dynamic dispatch (e.g.
/// `Arc<dyn DynBlobStore>`). It is automatically implemented for any
/// `T: BlobStore + 'static`.
///
/// Prefer [`BlobStore`] in generic code; use [`DynBlobStore`] when you need
/// to store a blob store behind a reference-counted pointer.
pub trait DynBlobStore: Send + Sync {
    /// Store `data` under `id`. See [`BlobStore::put`].
    ///
    /// # Errors
    ///
    /// Returns an error if the write fails.
    fn put<'a>(
        &'a self,
        id: BlobId,
        data: &'a [u8],
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), BlobError>> + Send + 'a>>;

    /// Retrieve the bytes stored under `id`. See [`BlobStore::get`].
    ///
    /// # Errors
    ///
    /// Returns [`BlobError::NotFound`] if the blob does not exist.
    fn get(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, BlobError>> + Send + '_>>;

    /// Soft-delete the blob with `id`. See [`BlobStore::delete`].
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    fn delete(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), BlobError>> + Send + '_>>;

    /// Returns `true` if a blob with `id` exists. See [`BlobStore::exists`].
    ///
    /// # Errors
    ///
    /// Returns an error on I/O failure.
    fn exists(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, BlobError>> + Send + '_>>;

    /// Return a pre-signed URL if supported. See [`BlobStore::presigned_get_url`].
    fn presigned_get_url(&self, id: BlobId, expires_secs: u64) -> Option<String>;
}

impl<T: BlobStore + 'static> DynBlobStore for T {
    fn put<'a>(
        &'a self,
        id: BlobId,
        data: &'a [u8],
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), BlobError>> + Send + 'a>> {
        Box::pin(BlobStore::put(self, id, data))
    }

    fn get(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, BlobError>> + Send + '_>>
    {
        Box::pin(BlobStore::get(self, id))
    }

    fn delete(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), BlobError>> + Send + '_>>
    {
        Box::pin(BlobStore::delete(self, id))
    }

    fn exists(
        &self,
        id: BlobId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, BlobError>> + Send + '_>>
    {
        Box::pin(BlobStore::exists(self, id))
    }

    fn presigned_get_url(&self, id: BlobId, expires_secs: u64) -> Option<String> {
        BlobStore::presigned_get_url(self, id, expires_secs)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn blob_ref_round_trips_through_column_value() {
        let id = uuid::Uuid::new_v4();
        let r = BlobRef {
            blob_id: id,
            size_bytes: 42,
            mime: "image/png".into(),
        };
        let col = r.to_column_value();
        let r2 = BlobRef::from_column_value(&col).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn blob_ref_from_invalid_json_is_error() {
        assert!(BlobRef::from_column_value("not json").is_err());
    }

    #[test]
    fn blob_ref_display_shows_uuid() {
        let id = uuid::Uuid::nil();
        let r = BlobRef {
            blob_id: id,
            size_bytes: 0,
            mime: "text/plain".into(),
        };
        assert_eq!(r.to_string(), id.to_string());
    }

    #[test]
    fn blob_ref_embeds_in_op_data() {
        let id = uuid::Uuid::new_v4();
        let r = BlobRef {
            blob_id: id,
            size_bytes: 100,
            mime: "application/pdf".into(),
        };
        let col_val = r.to_column_value();
        // Simulate what an Op would store
        let mut data = serde_json::Map::new();
        data.insert(
            "attachment".into(),
            serde_json::Value::String(col_val),
        );
        // Round-trip
        let stored = data["attachment"].as_str().unwrap();
        let r2 = BlobRef::from_column_value(stored).unwrap();
        assert_eq!(r, r2);
    }
}
