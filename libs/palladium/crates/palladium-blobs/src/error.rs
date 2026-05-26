//! Error types for the blob storage subsystem.

use thiserror::Error;

use crate::BlobId;

/// Errors produced by blob storage operations.
#[derive(Debug, Error)]
pub enum BlobError {
    /// No blob with the given identifier was found (or it has been soft-deleted).
    #[error("blob not found: {0}")]
    NotFound(BlobId),

    /// The blob exceeds the configured size limit.
    #[error("blob size {actual_bytes} bytes exceeds limit of {limit_mb} MiB")]
    SizeLimitExceeded {
        /// The configured maximum in mebibytes.
        limit_mb: u64,
        /// The actual blob size in bytes.
        actual_bytes: u64,
    },

    /// An I/O error occurred.
    #[error("blob I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// A JSON serialisation/deserialisation error occurred.
    #[error("blob serialisation error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// The storage backend returned an unexpected error.
    #[error("blob backend error: {0}")]
    Backend(String),

    /// The requested operation is not supported by this backend.
    #[error("blob operation not supported by this backend")]
    Unsupported,
}
