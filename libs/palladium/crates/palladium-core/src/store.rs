//! Abstract storage interface for [`Change`]s.

use std::future::Future;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{Change, Scope};

/// Maximum number of changes in one server page.
pub const MAX_PAGE_SIZE: u32 = 100;

/// Opaque server-issued append position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AppendCursor(String);

impl AppendCursor {
    /// Create a cursor from a canonical decimal append position.
    ///
    /// # Errors
    ///
    /// Returns an error when the position is non-canonical, zero, or exceeds
    /// the unsigned append-position range.
    pub fn parse(value: &str) -> Result<Self, String> {
        if value.is_empty()
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err("invalid append cursor".to_owned());
        }
        let position = value
            .parse::<u64>()
            .map_err(|_| "append cursor out of range".to_owned())?;
        if position == 0 {
            return Err("append cursor must be positive".to_owned());
        }
        Ok(Self(value.to_owned()))
    }

    /// Construct a cursor from an append position.
    #[must_use]
    pub fn new(position: u64) -> Self {
        Self(position.to_string())
    }

    /// Return the opaque wire representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Return its numeric value for store queries.
    #[must_use]
    pub fn position(&self) -> u64 {
        self.0.parse().unwrap_or(0)
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
    fn insert<'a>(
        &'a self,
        scope: &'a Scope,
        change: &'a Change,
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
