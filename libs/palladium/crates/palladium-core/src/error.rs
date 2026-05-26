//! Error types for `palladium-core`.

/// All errors that can originate from the core crate.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A string could not be parsed as a valid UUID.
    #[error("invalid node id: {0}")]
    InvalidNodeId(String),

    /// JSON serialisation or deserialisation failed.
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),

    /// A second attempt was made to open the same database path within this process.
    #[error("instance already open: {0}")]
    InstanceAlreadyOpen(String),
}

#[cfg(test)]
mod tests {
    use super::Error;

    #[test]
    fn instance_already_open_message() {
        let e = Error::InstanceAlreadyOpen("/tmp/foo.db".into());
        assert_eq!(e.to_string(), "instance already open: /tmp/foo.db");
    }

    #[test]
    fn invalid_node_id_message() {
        let e = Error::InvalidNodeId("bad".into());
        assert_eq!(e.to_string(), "invalid node id: bad");
    }

    #[test]
    fn serialization_error_from_serde() {
        let bad_json = r#"{"unclosed:"#;
        let result: serde_json::Result<serde_json::Value> = serde_json::from_str(bad_json);
        #[allow(clippy::unwrap_used)]
        let err: Error = result.unwrap_err().into();
        assert!(err.to_string().starts_with("serialization failed:"));
    }
}
