//! Opaque tenant [`Scope`] for the change store.

use serde::{Deserialize, Serialize};

/// An **opaque** tenant scope that partitions a [`ChangeStore`](crate::ChangeStore).
///
/// Palladium assigns `Scope` **no meaning** — it is an uninterpreted key the
/// host (e.g. Atrium) derives and authorizes per request; the store merely
/// partitions changes by it so two scopes never see each other's data. Keeping
/// it opaque is what lets `palladium-*` stay vendor- and domain-neutral: a
/// "workspace", a "family", or any other tenant concept lives entirely in the
/// host, encoded into this string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Scope(String);

impl Scope {
    /// Wrap an arbitrary key as a scope.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Borrow the underlying opaque key.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for Scope {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for Scope {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl std::fmt::Display for Scope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::Scope;

    #[test]
    fn round_trips_the_opaque_key() {
        let s = Scope::new("workspace-42");
        assert_eq!(s.as_str(), "workspace-42");
        assert_eq!(s.to_string(), "workspace-42");
    }

    #[test]
    fn from_str_and_string_are_equivalent() {
        assert_eq!(Scope::from("a"), Scope::from("a".to_owned()));
    }

    #[test]
    fn distinct_keys_are_unequal() {
        assert_ne!(Scope::new("a"), Scope::new("b"));
    }

    #[test]
    fn serde_json_round_trip() {
        let s = Scope::new("tenant");
        let json = serde_json::to_string(&s).unwrap();
        let back: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }
}
