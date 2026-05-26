//! Error types for `palladium-sqlite`.

/// All errors that can originate from the `SQLite` store.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A `SQLite` or connection-pool error.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    /// JSON serialisation or deserialisation failed.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// A value read from the database is invalid or out of range.
    #[error("invalid data: {0}")]
    InvalidData(String),

    /// An error from the core crate (e.g. instance already open).
    #[error(transparent)]
    Core(#[from] palladium_core::Error),

    /// An I/O error (e.g. lock file creation).
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Convenience `Result` alias using [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::Error;

    #[test]
    fn invalid_data_displays_message() {
        let e = Error::InvalidData("bad uuid xyz".into());
        assert!(e.to_string().contains("bad uuid xyz"));
    }

    #[test]
    fn serialization_error_displays_message() {
        #[allow(clippy::unwrap_used)]
        let inner: serde_json::Error =
            serde_json::from_str::<serde_json::Value>("{bad").unwrap_err();
        let e = Error::from(inner);
        assert!(e.to_string().starts_with("serialization error:"));
    }

    #[test]
    fn error_variants_are_debug_printable() {
        let e = Error::InvalidData("test".into());
        assert!(!format!("{e:?}").is_empty());
    }
}
