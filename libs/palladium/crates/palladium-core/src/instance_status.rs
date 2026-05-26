//! Health and status types returned by engine health checks and `/health` endpoints.

/// Health and runtime statistics for one engine instance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct InstanceStatus {
    /// Instance name.
    pub name: String,
    /// `true` if the instance is healthy.
    pub ok: bool,
    /// Error message when `ok = false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Total row count across all user tables.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<u64>,
    /// HLC string of the most recent change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_hlc: Option<String>,
    /// Database file size in bytes (`SQLite` only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_size_bytes: Option<u64>,
}

/// Aggregate health response from `GET /health`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GlobalHealthResponse {
    /// `true` when all instances are healthy.
    pub ok: bool,
    /// Per-instance status.
    pub instances: Vec<InstanceStatus>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_status_ok_omits_error_field() {
        let s = InstanceStatus {
            name: "main".into(),
            ok: true,
            error: None,
            row_count: Some(42),
            last_hlc: None,
            db_size_bytes: None,
        };
        #[allow(clippy::unwrap_used)]
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn global_health_all_ok() {
        let r = GlobalHealthResponse {
            ok: true,
            instances: vec![],
        };
        assert!(r.ok);
    }
}
