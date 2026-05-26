//! Error types for `palladium-postgres`.

/// All errors that can originate from the `PostgreSQL` store.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A `PostgreSQL` or connection-pool error.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    /// JSON serialisation or deserialisation failed.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// A value read from the database is invalid or out of range.
    #[error("invalid data: {0}")]
    InvalidData(String),

    /// A string used as an SQL identifier contains invalid characters.
    #[error("invalid identifier: {0:?}")]
    InvalidIdentifier(String),

    /// An error from the core crate (e.g. instance already open).
    #[error(transparent)]
    Core(#[from] palladium_core::Error),
}

/// Convenience `Result` alias using [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
