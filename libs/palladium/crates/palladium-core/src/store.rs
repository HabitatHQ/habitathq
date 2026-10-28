//! Abstract storage interface for [`Change`]s.

use std::future::Future;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{Change, Scope};

/// Maximum number of changes in one server page.
pub const MAX_PAGE_SIZE: u32 = 100;

/// Opaque server-issued append position. Serde preserves its canonical decimal
/// string representation; cursors always hold a positive position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppendCursor {
    wire: String,
    position: std::num::NonZeroU64,
}

impl Serialize for AppendCursor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.wire)
    }
}
impl<'de> Deserialize<'de> for AppendCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let position = Self::parse_position(&wire).map_err(serde::de::Error::custom)?;
        Ok(Self { wire, position })
    }
}

impl AppendCursor {
    /// Create a cursor from a canonical decimal append position.
    ///
    /// # Errors
    ///
    /// Returns an error when the position is non-canonical, zero, or exceeds
    /// the unsigned append-position range.
    pub fn parse(value: &str) -> Result<Self, String> {
        let position = Self::parse_position(value)?;
        Ok(Self {
            wire: value.to_owned(),
            position,
        })
    }

    fn parse_position(value: &str) -> Result<std::num::NonZeroU64, String> {
        if value.is_empty()
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err("invalid append cursor".to_owned());
        }
        let position = value
            .parse::<u64>()
            .map_err(|_| "append cursor out of range".to_owned())?;
        std::num::NonZeroU64::new(position)
            .ok_or_else(|| "append cursor must be positive".to_owned())
    }

    /// Construct a cursor from a nonzero append position.
    ///
    /// The type guarantees a strictly positive position.
    #[must_use]
    pub fn new(position: std::num::NonZeroU64) -> Self {
        Self {
            wire: position.get().to_string(),
            position,
        }
    }

    /// Return the opaque wire representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.wire
    }

    /// Return its numeric value for store queries.
    #[must_use]
    pub const fn position(&self) -> u64 {
        self.position.get()
    }
}

/// A table-qualified row that a client must remove from its local replica.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PagePurge {
    /// Table containing the row.
    pub table: String,
    /// Stable replicated row identifier.
    pub row_id: Uuid,
}

/// Server control information for a sync page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PageControl {
    /// Whether the client must discard its incremental state and refetch.
    #[serde(rename = "mustRefetch")]
    pub must_refetch: bool,
}

/// A bounded page of append history using the version-one wire envelope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ChangePage {
    /// Protocol version.
    pub version: u16,
    /// Changes after the requested cursor.
    pub changes: Vec<Change>,
    /// Table-qualified rows the client must remove.
    pub purges: Vec<PagePurge>,
    /// Server-side events represented as JSON values.
    #[cfg_attr(feature = "openapi", schema(value_type = Vec<Object>))]
    pub events: Vec<Value>,
    /// Cursor at the last returned change, if any.
    pub cursor: Option<AppendCursor>,
    /// Upper bound captured for this page.
    #[serde(rename = "upperBound")]
    pub upper_bound: AppendCursor,
    /// Whether the page reached the captured upper bound.
    #[serde(rename = "caughtUp")]
    pub caught_up: bool,
    /// Client control flags.
    pub control: PageControl,
}

/// Result of attempting to append a change to a [`ChangeStore`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertOutcome {
    /// Newly assigned append position.
    Inserted(AppendCursor),
    /// Existing identical payload.
    Duplicate(AppendCursor),
}

/// Persistence layer for [`Change`]s.
pub trait ChangeStore {
    /// Store error.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Atomically append a change in a scope, with content-checked idempotency.
    /// `now_millis` is the authoritative server time used only for fresh inserts;
    /// a previously accepted identical retry is returned regardless of skew.
    fn insert<'a>(
        &'a self,
        scope: &'a Scope,
        change: &'a Change,
        now_millis: u64,
    ) -> impl Future<Output = Result<InsertOutcome, Self::Error>> + Send + 'a;

    /// Return a bounded append-history page.
    fn page<'a>(
        &'a self,
        scope: &'a Scope,
        after: Option<&'a AppendCursor>,
        limit: u32,
    ) -> impl Future<Output = Result<ChangePage, Self::Error>> + Send + 'a;

    /// Retrieve a change by scoped ID.
    fn get<'a>(
        &'a self,
        scope: &'a Scope,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Change>, Self::Error>> + Send + 'a;
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{AppendCursor, ChangePage};

    #[test]
    fn append_cursor_deserialization_accepts_only_canonical_positive_u64_strings() {
        for value in ["1", "42", "18446744073709551615"] {
            let encoded = format!("\"{value}\"");
            let cursor: AppendCursor = serde_json::from_str(&encoded).unwrap();
            assert_eq!(cursor.as_str(), value);
            assert_eq!(serde_json::to_string(&cursor).unwrap(), encoded);
        }

        for value in [
            "0",
            "00",
            "01",
            "+1",
            "-1",
            " 1",
            "1 ",
            "١",
            "18446744073709551616",
            "",
        ] {
            let encoded = serde_json::to_string(value).unwrap();
            assert!(
                serde_json::from_str::<AppendCursor>(&encoded).is_err(),
                "accepted invalid cursor {value:?}"
            );
        }
        assert!(serde_json::from_str::<AppendCursor>("1").is_err());
    }

    #[test]
    fn parse_and_constructor_enforce_positive_canonical_positions() {
        use std::num::NonZeroU64;

        assert_eq!(AppendCursor::new(NonZeroU64::new(1).unwrap()).as_str(), "1");
        assert_eq!(
            AppendCursor::new(NonZeroU64::new(u64::MAX).unwrap()).position(),
            u64::MAX
        );
        for value in [
            "0",
            "00",
            "01",
            "+1",
            "-1",
            " 1",
            "1 ",
            "١",
            "18446744073709551616",
            "",
        ] {
            assert!(AppendCursor::parse(value).is_err(), "accepted {value:?}");
        }
        assert_eq!(
            AppendCursor::parse("18446744073709551615")
                .unwrap()
                .position(),
            u64::MAX
        );
    }

    #[test]
    fn change_page_deserialization_rejects_invalid_embedded_cursor() {
        let page = r#"{"version":1,"changes":[],"purges":[],"events":[],"cursor":null,"upperBound":"0","caughtUp":true,"control":{"mustRefetch":false}}"#;
        assert!(serde_json::from_str::<ChangePage>(page).is_err());
    }
}
