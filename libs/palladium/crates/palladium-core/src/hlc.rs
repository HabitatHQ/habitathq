//! Hybrid Logical Clock (HLC) for causal timestamp ordering.
//!
//! HLC combines wall-clock time with a logical counter so that:
//! * Causally related events are always ordered.
//! * The timestamp stays close to real wall time.
//!
//! Reference: Kulkarni et al., "Logical Physical Clocks and Consistent
//! Snapshots in Globally Distributed Databases", ICDCS 2014.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::NodeId;

/// A Hybrid Logical Clock timestamp.
///
/// Ordering is lexicographic on `(millis, counter, node_id)`, which means
/// larger values represent later events. `node_id` acts as a deterministic
/// tie-breaker when two nodes generate an event at the same logical instant.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Hlc {
    /// Wall-clock milliseconds since Unix epoch (never decreases).
    millis: u64,
    /// Logical counter; incremented when wall time is unchanged.
    counter: u32,
    /// Node identifier — breaks ties deterministically.
    node_id: NodeId,
}

impl Hlc {
    /// Creates a fresh HLC at `wall_millis` with counter `0`.
    #[must_use]
    pub const fn new(node_id: NodeId, wall_millis: u64) -> Self {
        Self { millis: wall_millis, counter: 0, node_id }
    }

    /// Constructs an HLC from raw field values.
    ///
    /// Prefer [`Hlc::new`] for creating the first HLC on a node, and
    /// [`Hlc::send`] / [`Hlc::recv`] for advancing it. This constructor is
    /// intended for low-level use: deserialising from storage, testing, or
    /// building a cursor from parsed components.
    #[must_use]
    pub const fn from_parts(millis: u64, counter: u32, node_id: NodeId) -> Self {
        Self { millis, counter, node_id }
    }

    /// Wall-clock milliseconds since Unix epoch.
    #[must_use]
    pub const fn millis(&self) -> u64 {
        self.millis
    }

    /// Logical counter; incremented when wall time is unchanged.
    #[must_use]
    pub const fn counter(&self) -> u32 {
        self.counter
    }

    /// Node identifier — breaks ties deterministically.
    #[must_use]
    pub const fn node_id(&self) -> NodeId {
        self.node_id
    }

    /// Advances the clock for a **local send** (or write) event.
    ///
    /// The new timestamp will be strictly greater than `self`:
    /// * If `wall_millis > self.millis`, reset counter to `0`.
    /// * Otherwise, increment counter; if counter overflows `u32::MAX`,
    ///   advance millis by 1 and reset counter to `0`.
    #[must_use]
    pub fn send(self, wall_millis: u64) -> Self {
        let millis = self.millis.max(wall_millis);
        let (millis, counter) = if millis == self.millis {
            self.counter
                .checked_add(1)
                .map_or_else(|| (millis.saturating_add(1), 0_u32), |c| (millis, c))
        } else {
            (millis, 0)
        };
        Self { millis, counter, node_id: self.node_id }
    }

    /// Returns a zero-padded string key that sorts lexicographically in the
    /// same order as `(millis, counter, node_id)` tuple comparison.
    ///
    /// Format: `{millis:020}_{counter:010}_{node_id_hex:032x}`
    ///
    /// This is the canonical cursor format for the sync API's `?after=`
    /// parameter and the storage index key used by all `ChangeStore` backends.
    #[must_use]
    pub fn sort_key(&self) -> String {
        format!(
            "{:020}_{:010}_{:032x}",
            self.millis,
            self.counter,
            self.node_id.as_uuid().as_u128()
        )
    }

    /// Reconstructs an [`Hlc`] from raw database column values.
    ///
    /// All `ChangeStore` backends store the HLC as three separate columns
    /// (`hlc_millis BIGINT`, `hlc_counter BIGINT`, `hlc_node_id TEXT`).
    /// This constructor centralises the conversion and range-checking so
    /// each backend does not need to duplicate the logic.
    ///
    /// # Errors
    /// Returns a human-readable description if any field is invalid:
    /// - `millis < 0` — the stored `i64` was negative
    /// - `counter` outside `[0, u32::MAX]` — out of range
    /// - `node_id_str` is not a valid [`NodeId`] string representation
    pub fn from_db_parts(millis: i64, counter: i64, node_id_str: &str) -> Result<Self, String> {
        let node_id = node_id_str
            .parse::<NodeId>()
            .map_err(|e| format!("invalid node id: {e}"))?;
        let millis = u64::try_from(millis)
            .map_err(|_| format!("hlc_millis {millis} is negative"))?;
        let counter = u32::try_from(counter)
            .map_err(|_| format!("hlc_counter {counter} out of u32 range"))?;
        Ok(Self { millis, counter, node_id })
    }

    /// Merges a **remote** HLC received with this local HLC.
    ///
    /// The result is strictly greater than both `self` and `remote`,
    /// ensuring the receive event is causally after the send.
    /// If the logical counter would overflow `u32::MAX`, millis is advanced
    /// by 1 and the counter resets to `0` to preserve the strictly-greater
    /// invariant.
    #[must_use]
    pub fn recv(self, wall_millis: u64, remote: &Self) -> Self {
        let millis = self.millis.max(remote.millis).max(wall_millis);
        let overflow = |m: u64| (m.saturating_add(1), 0_u32);
        let (millis, counter) = if millis == self.millis && millis == remote.millis {
            self.counter
                .max(remote.counter)
                .checked_add(1)
                .map_or_else(|| overflow(millis), |c| (millis, c))
        } else if millis == self.millis {
            self.counter
                .checked_add(1)
                .map_or_else(|| overflow(millis), |c| (millis, c))
        } else if millis == remote.millis {
            remote
                .counter
                .checked_add(1)
                .map_or_else(|| overflow(millis), |c| (millis, c))
        } else {
            (millis, 0)
        };
        Self { millis, counter, node_id: self.node_id }
    }
}

impl FromStr for Hlc {
    type Err = String;

    /// Parses an HLC from its sort-key string representation.
    ///
    /// Format: `{millis:020}_{counter:010}_{node_id_hex:032x}`
    ///
    /// # Errors
    /// Returns a human-readable description if the string is not a valid
    /// sort key (wrong structure, non-numeric fields, or invalid hex node id).
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (millis_str, rest) = s
            .split_once('_')
            .ok_or_else(|| format!("invalid HLC sort key: {s}"))?;
        let (counter_str, node_hex) = rest
            .split_once('_')
            .ok_or_else(|| format!("invalid HLC sort key: {s}"))?;
        let millis = millis_str
            .parse::<u64>()
            .map_err(|_| format!("invalid millis in HLC sort key: {s}"))?;
        let counter = counter_str
            .parse::<u32>()
            .map_err(|_| format!("invalid counter in HLC sort key: {s}"))?;
        let node_u128 = u128::from_str_radix(node_hex, 16)
            .map_err(|_| format!("invalid node_id in HLC sort key: {s}"))?;
        let node_id = NodeId::from_uuid(uuid::Uuid::from_u128(node_u128));
        Ok(Self { millis, counter, node_id })
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use uuid::Uuid;

    use super::*;
    use crate::NodeId;

    fn node(n: u128) -> NodeId {
        NodeId::from_uuid(Uuid::from_u128(n))
    }

    fn hlc(millis: u64, counter: u32, n: u128) -> Hlc {
        Hlc::from_parts(millis, counter, node(n))
    }

    // ── send ──────────────────────────────────────────────────────────────

    #[test]
    fn send_increments_counter_when_wall_unchanged() {
        let t = hlc(100, 0, 1);
        let t1 = t.send(100);
        assert_eq!(t1.millis(), 100);
        assert_eq!(t1.counter(), 1);
    }

    #[test]
    fn send_resets_counter_when_wall_advances() {
        let t = hlc(100, 5, 1);
        let t1 = t.send(200);
        assert_eq!(t1.millis(), 200);
        assert_eq!(t1.counter(), 0);
    }

    #[test]
    fn send_uses_max_of_wall_and_current_millis() {
        let t = hlc(200, 3, 1);
        let t1 = t.send(100); // wall is behind local — use local
        assert_eq!(t1.millis(), 200);
        assert_eq!(t1.counter(), 4); // incremented because millis unchanged
    }

    #[test]
    fn send_result_is_strictly_greater_than_self() {
        let t = hlc(100, 0, 1);
        assert!(t.send(100) > t);
        assert!(t.send(200) > t);
    }

    #[test]
    fn send_counter_overflow_advances_millis() {
        // When counter == u32::MAX and wall hasn't moved, millis must advance.
        let t = hlc(100, u32::MAX, 1);
        let t1 = t.send(100);
        assert!(t1 > t, "result must be strictly greater than self");
        assert_eq!(t1.millis(), 101, "millis must advance on counter overflow");
        assert_eq!(t1.counter(), 0);
    }

    // ── recv ─────────────────────────────────────────────────────────────

    #[test]
    fn recv_same_millis_takes_max_counter_plus_one() {
        let local = hlc(100, 3, 1);
        let remote = hlc(100, 7, 2);
        let merged = local.recv(100, &remote);
        assert_eq!(merged.millis(), 100);
        assert_eq!(merged.counter(), 8); // max(3,7)+1
    }

    #[test]
    fn recv_local_millis_ahead_increments_local_counter() {
        let local = hlc(200, 5, 1);
        let remote = hlc(100, 99, 2);
        let merged = local.recv(100, &remote);
        assert_eq!(merged.millis(), 200);
        assert_eq!(merged.counter(), 6);
    }

    #[test]
    fn recv_remote_millis_ahead_increments_remote_counter() {
        let local = hlc(100, 5, 1);
        let remote = hlc(200, 3, 2);
        let merged = local.recv(100, &remote);
        assert_eq!(merged.millis(), 200);
        assert_eq!(merged.counter(), 4);
    }

    #[test]
    fn recv_wall_millis_ahead_resets_counter() {
        let local = hlc(100, 5, 1);
        let remote = hlc(100, 5, 2);
        let merged = local.recv(300, &remote); // wall beats both
        assert_eq!(merged.millis(), 300);
        assert_eq!(merged.counter(), 0);
    }

    #[test]
    fn recv_result_is_strictly_greater_than_both_inputs() {
        let local = hlc(100, 3, 1);
        let remote = hlc(100, 7, 2);
        let merged = local.recv(100, &remote);
        assert!(merged > local);
        assert!(merged > remote);
    }

    #[test]
    fn recv_counter_overflow_both_max_advances_millis() {
        let local = hlc(100, u32::MAX, 1);
        let remote = hlc(100, u32::MAX, 2);
        let merged = local.recv(100, &remote);
        assert!(merged > local, "result must be > local");
        assert!(merged > remote, "result must be > remote");
        assert_eq!(merged.millis(), 101);
        assert_eq!(merged.counter(), 0);
    }

    #[test]
    fn recv_counter_overflow_local_max_advances_millis() {
        let local = hlc(200, u32::MAX, 1);
        let remote = hlc(100, 5, 2);
        let merged = local.recv(100, &remote);
        assert!(merged > local);
        assert!(merged > remote);
        assert_eq!(merged.millis(), 201);
        assert_eq!(merged.counter(), 0);
    }

    #[test]
    fn recv_counter_overflow_remote_max_advances_millis() {
        let local = hlc(100, 5, 1);
        let remote = hlc(200, u32::MAX, 2);
        let merged = local.recv(100, &remote);
        assert!(merged > local);
        assert!(merged > remote);
        assert_eq!(merged.millis(), 201);
        assert_eq!(merged.counter(), 0);
    }

    // ── sort_key ──────────────────────────────────────────────────────────

    #[test]
    fn sort_key_has_expected_format() {
        let t = hlc(1_700_000_000_000, 42, 1);
        let key = t.sort_key();
        // 20 + 1 + 10 + 1 + 32 = 64 chars
        assert_eq!(key.len(), 64);
        assert!(key.starts_with(&format!("{:020}", 1_700_000_000_000_u64)), "millis prefix");
    }

    #[test]
    fn sort_key_is_lexicographically_ordered_over_send_sequence() {
        let n = node(1);
        let h1 = Hlc::new(n, 1_000);
        let h2 = h1.send(2_000);
        let h3 = h2.send(3_000);
        assert!(h1.sort_key() < h2.sort_key());
        assert!(h2.sort_key() < h3.sort_key());
    }

    #[test]
    fn sort_key_millis_dominates() {
        let n = node(1);
        let low_millis_high_counter = Hlc::from_parts(100, 9_999, n);
        let high_millis_low_counter = Hlc::from_parts(200, 0, n);
        assert!(low_millis_high_counter.sort_key() < high_millis_low_counter.sort_key());
    }

    #[test]
    fn sort_key_counter_breaks_millis_tie() {
        let n = node(1);
        let a = Hlc::from_parts(500, 0, n);
        let b = Hlc::from_parts(500, 1, n);
        assert!(a.sort_key() < b.sort_key());
    }

    #[test]
    fn sort_key_node_id_breaks_counter_tie() {
        let a = Hlc::from_parts(500, 0, node(1));
        let b = Hlc::from_parts(500, 0, node(2));
        assert_ne!(a.sort_key(), b.sort_key());
    }

    #[test]
    fn sort_key_orders_match_hlc_ord() {
        let pairs = [
            (Hlc::from_parts(1_000, 0, node(1)), Hlc::from_parts(2_000, 0, node(1))),
            (Hlc::from_parts(1_000, 0, node(1)), Hlc::from_parts(1_000, 1, node(1))),
            (Hlc::from_parts(1_000, 0, node(1)), Hlc::from_parts(1_000, 0, node(2))),
            (Hlc::from_parts(0, 0, node(0)), Hlc::from_parts(1, 0, node(0))),
        ];
        for (a, b) in pairs {
            assert_eq!(
                a.cmp(&b),
                a.sort_key().cmp(&b.sort_key()),
                "sort_key ordering disagreed with Hlc::Ord for {a:?} vs {b:?}"
            );
        }
    }

    #[test]
    fn sort_key_zero_millis_sorts_first() {
        let zero = Hlc::from_parts(0, 0, node(0));
        let nonzero = Hlc::from_parts(1, 0, node(0));
        assert!(zero.sort_key() < nonzero.sort_key());
    }

    #[test]
    fn sort_key_max_counter_well_formed() {
        let a = Hlc::from_parts(100, u32::MAX - 1, node(1));
        let b = Hlc::from_parts(100, u32::MAX, node(1));
        assert!(a.sort_key() < b.sort_key());
    }

    #[test]
    fn sort_key_i64_max_millis_is_valid() {
        #[allow(clippy::cast_sign_loss)]
        let max_millis = i64::MAX as u64;
        let h = Hlc::from_parts(max_millis, 0, node(1));
        let key = h.sort_key();
        assert!(key.starts_with(&format!("{max_millis:020}")));
    }

    // ── from_str (sort key round-trip) ─────────────────────────────────────

    #[test]
    fn from_str_round_trips_sort_key() {
        let original = hlc(1_234_567, 42, 99);
        let parsed: Hlc = original.sort_key().parse().unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn from_str_rejects_too_few_parts() {
        assert!("00000000000000001000".parse::<Hlc>().is_err());
    }

    #[test]
    fn from_str_rejects_non_numeric_millis() {
        assert!(
            "zzzzzzzzzzzzzzzzzzzz_0000000000_00000000000000000000000000000000"
                .parse::<Hlc>()
                .is_err()
        );
    }

    #[test]
    fn from_str_rejects_non_numeric_counter() {
        assert!(
            "00000000000000001000_xxxxxxxxxx_00000000000000000000000000000000"
                .parse::<Hlc>()
                .is_err()
        );
    }

    #[test]
    fn from_str_rejects_non_hex_node_id() {
        assert!(
            "00000000000000001000_0000000042_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
                .parse::<Hlc>()
                .is_err()
        );
    }

    // ── from_db_parts ──────────────────────────────────────────────────────

    #[test]
    fn from_db_parts_round_trips() {
        let original = hlc(1_234_567_890, 42, 99);
        let restored = Hlc::from_db_parts(
            i64::try_from(original.millis()).unwrap(),
            i64::from(original.counter()),
            &original.node_id().to_string(),
        )
        .unwrap();
        assert_eq!(original, restored);
    }

    #[test]
    fn from_db_parts_rejects_negative_millis() {
        assert!(Hlc::from_db_parts(-1, 0, &node(1).to_string()).is_err());
    }

    #[test]
    fn from_db_parts_rejects_counter_out_of_range() {
        let big: i64 = i64::from(u32::MAX) + 1;
        assert!(Hlc::from_db_parts(1_000, big, &node(1).to_string()).is_err());
    }

    #[test]
    fn from_db_parts_rejects_invalid_node_id() {
        assert!(Hlc::from_db_parts(1_000, 0, "not-a-uuid").is_err());
    }

    // ── ordering ─────────────────────────────────────────────────────────

    #[test]
    fn millis_dominates_ordering() {
        assert!(hlc(200, 0, 1) > hlc(100, 999, 1));
    }

    #[test]
    fn counter_breaks_millis_tie() {
        assert!(hlc(100, 1, 1) > hlc(100, 0, 1));
    }

    #[test]
    fn node_id_breaks_counter_tie() {
        // node(2) vs node(1) — deterministic but direction depends on UUID bytes
        let a = hlc(100, 0, 1);
        let b = hlc(100, 0, 2);
        assert_ne!(a, b); // they are ordered, never equal
    }

    // ── serde ─────────────────────────────────────────────────────────────

    #[test]
    fn serde_json_round_trip() {
        #[allow(clippy::unwrap_used)]
        {
            let t = hlc(12_345_678, 42, 99);
            let json = serde_json::to_string(&t).unwrap();
            let back: Hlc = serde_json::from_str(&json).unwrap();
            assert_eq!(t, back);
        }
    }
}
