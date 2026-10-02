//! Authoritative server clock contract shared by Palladium HTTP servers.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::V1_MAX_FUTURE_HLC_MILLIS;

/// Failure to obtain a safe Unix-millisecond server timestamp.
#[derive(Debug, thiserror::Error)]
pub enum ClockError {
    /// The system clock is earlier than the Unix epoch.
    #[error("system clock is before the Unix epoch")]
    BeforeUnixEpoch,
    /// The system clock cannot be represented as a `u64` millisecond value.
    #[error("system clock exceeds the supported Unix-millisecond range")]
    OutOfRange,
}

/// Source of authoritative server Unix time.
pub trait ServerClock: Send + Sync + 'static {
    /// Return the current Unix timestamp in milliseconds.
    ///
    /// # Errors
    ///
    /// Returns an error when the clock is earlier than the Unix epoch or cannot
    /// be represented by the v1 wire type.
    fn now_millis(&self) -> Result<u64, ClockError>;
}

/// Production server clock backed by [`SystemTime`].
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl ServerClock for SystemClock {
    fn now_millis(&self) -> Result<u64, ClockError> {
        let duration = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ClockError::BeforeUnixEpoch)?;
        u64::try_from(duration.as_millis()).map_err(|_| ClockError::OutOfRange)
    }
}

/// Version-one authenticated clock response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ClockResponse {
    /// Clock endpoint wire version.
    pub version: u8,
    /// Authoritative server Unix time in milliseconds.
    pub now_ms: u64,
    /// Maximum future offset accepted for a fresh uploaded change.
    pub max_future_ms: u64,
}

impl ClockResponse {
    /// Construct the version-one response for `now_ms`.
    #[must_use]
    pub const fn v1(now_ms: u64) -> Self {
        Self {
            version: 1,
            now_ms,
            max_future_ms: V1_MAX_FUTURE_HLC_MILLIS,
        }
    }
}
