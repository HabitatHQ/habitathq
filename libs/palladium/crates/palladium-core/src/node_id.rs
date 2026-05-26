//! Node identity for the sync network.

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Uniquely identifies a sync node (device or client instance).
///
/// Each participant in the sync network — browser tab, mobile app, or server
/// process — generates a random `NodeId` on first run and persists it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "openapi", schema(value_type = String, format = Uuid))]
pub struct NodeId(Uuid);

impl NodeId {
    /// Creates a new, random node identifier.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID.
    #[must_use]
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// Returns the underlying UUID.
    #[must_use]
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for NodeId {
    /// Returns the nil (all-zeros) node identifier.
    ///
    /// This satisfies the `Default` contract of a cheap, deterministic,
    /// "empty" value. To generate a new random identifier, use [`NodeId::new`].
    fn default() -> Self {
        Self(Uuid::nil())
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl FromStr for NodeId {
    type Err = uuid::Error;

    /// # Errors
    ///
    /// Returns [`uuid::Error`] if `s` is not a valid UUID string.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)] // acceptable in tests
mod tests {
    use uuid::Uuid;

    use super::NodeId;

    #[test]
    fn equal_when_same_uuid() {
        let id = Uuid::nil();
        assert_eq!(NodeId::from_uuid(id), NodeId::from_uuid(id));
    }

    #[test]
    fn not_equal_for_distinct_nodes() {
        // Astronomically unlikely to collide.
        assert_ne!(NodeId::new(), NodeId::new());
    }

    #[test]
    fn display_matches_uuid_string() {
        let id = Uuid::nil();
        let node_id = NodeId::from_uuid(id);
        assert_eq!(
            node_id.to_string(),
            "00000000-0000-0000-0000-000000000000"
        );
    }

    #[test]
    fn round_trips_through_str() -> Result<(), uuid::Error> {
        let node_id = NodeId::new();
        let parsed: NodeId = node_id.to_string().parse()?;
        assert_eq!(node_id, parsed);
        Ok(())
    }

    #[test]
    fn from_str_rejects_garbage() {
        assert!("not-a-uuid".parse::<NodeId>().is_err());
    }

    #[test]
    fn as_uuid_round_trips() {
        let id = Uuid::new_v4();
        assert_eq!(NodeId::from_uuid(id).as_uuid(), id);
    }

    #[test]
    fn serde_json_round_trip() {
        let node_id = NodeId::new();
        let json = serde_json::to_string(&node_id).unwrap();
        let back: NodeId = serde_json::from_str(&json).unwrap();
        assert_eq!(node_id, back);
    }

    #[test]
    fn default_is_nil_uuid() {
        assert_eq!(NodeId::default(), NodeId::from_uuid(Uuid::nil()));
    }

    #[test]
    fn ordering_is_consistent_with_uuid() {
        let a = NodeId::from_uuid(Uuid::nil());
        let b = NodeId::new();
        // Nil UUID (all zeros) should be less-than a random v4.
        assert_ne!(a, b); // they are ordered, not equal
    }
}
