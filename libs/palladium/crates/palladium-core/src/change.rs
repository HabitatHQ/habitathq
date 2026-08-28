//! Atomic, causally-stamped batches of operations.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Hlc, Op};

/// An atomic batch of [`Op`]s from a single node at a single logical instant.
///
/// A `Change` is the unit of replication: it is created locally, serialised,
/// and shipped to peers over the network (or stored for later sync).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Change {
    /// Stable, unique identifier for this change (UUID v4).
    pub id: Uuid,
    /// Causal timestamp assigned by the originating node.
    pub hlc: Hlc,
    /// Ordered list of row-level operations in this batch.
    pub ops: Vec<Op>,
}

impl Change {
    /// Creates a new change with a freshly-generated UUID.
    #[must_use]
    pub fn new(hlc: Hlc, ops: Vec<Op>) -> Self {
        Self {
            id: Uuid::new_v4(),
            hlc,
            ops,
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use serde::Deserialize;
    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::Change;
    use crate::{Hlc, NodeId, Op};

    #[derive(Deserialize)]
    struct ChangesEnvelope {
        changes: Vec<Change>,
        cursor: String,
        #[serde(default)]
        purges: Vec<Value>,
        #[serde(default)]
        events: Vec<Value>,
    }

    #[derive(Deserialize)]
    struct InvalidFixture {
        input: Value,
        expected_classification: String,
    }

    fn classify_fixture(input: &Value) -> &'static str {
        if let Some(cursor) = input.get("cursor").and_then(Value::as_str) {
            return if cursor.parse::<u64>().is_err() {
                "invalid_cursor"
            } else {
                "valid"
            };
        }
        if input.get("hlc").map_or(true, |hlc| {
            serde_json::from_value::<Hlc>(hlc.clone()).is_err()
        }) {
            return "invalid_hlc";
        }
        if input.get("ops").map_or(true, |ops| {
            serde_json::from_value::<Vec<Op>>(ops.clone()).is_err()
        }) {
            return "invalid_op";
        }
        "valid"
    }

    #[test]
    fn shared_wire_fixtures_round_trip_and_classify_invalid_inputs() {
        let envelope: ChangesEnvelope = serde_json::from_str(include_str!(
            "../../../protocol-fixtures/changes-envelope.valid.json"
        ))
        .unwrap();
        let change = envelope.changes.first().unwrap();
        let encoded = serde_json::to_value(change).unwrap();
        let decoded: Change = serde_json::from_value(encoded.clone()).unwrap();

        assert_eq!(&decoded, change);
        assert_eq!(encoded, serde_json::to_value(change).unwrap());
        assert_eq!(envelope.cursor.parse::<u64>().unwrap(), 42);
        assert!(envelope.purges.is_empty());
        assert!(envelope.events.is_empty());

        let invalid: Vec<InvalidFixture> =
            serde_json::from_str(include_str!("../../../protocol-fixtures/wire-invalid.json"))
                .unwrap();
        for fixture in invalid {
            assert_eq!(
                classify_fixture(&fixture.input),
                fixture.expected_classification
            );
        }
    }

    fn node1() -> NodeId {
        NodeId::from_uuid(Uuid::from_u128(1))
    }

    fn base_hlc() -> Hlc {
        Hlc::new(node1(), 1_000)
    }

    fn insert_op() -> Op {
        Op::Insert {
            table: "todos".into(),
            row_id: Uuid::nil(),
            data: json!({"text": "buy milk"}),
        }
    }

    #[test]
    fn new_change_has_unique_ids() {
        let hlc = base_hlc();
        let a = Change::new(hlc, vec![]);
        let b = Change::new(hlc, vec![]);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn empty_change_has_no_ops() {
        let c = Change::new(base_hlc(), vec![]);
        assert!(c.ops.is_empty());
        assert_eq!(c.ops.len(), 0);
    }

    #[test]
    fn non_empty_change_has_ops() {
        let c = Change::new(base_hlc(), vec![insert_op()]);
        assert!(!c.ops.is_empty());
        assert_eq!(c.ops.len(), 1);
    }

    #[test]
    fn ops_len_reflects_count() {
        let ops = vec![insert_op(), insert_op(), insert_op()];
        let c = Change::new(base_hlc(), ops);
        assert_eq!(c.ops.len(), 3);
    }

    #[test]
    fn serde_json_round_trip() {
        let c = Change::new(base_hlc(), vec![insert_op()]);
        let json = serde_json::to_string(&c).unwrap();
        let back: Change = serde_json::from_str(&json).unwrap();
        // id and hlc must survive the round-trip
        assert_eq!(c.id, back.id);
        assert_eq!(c.hlc, back.hlc);
        assert_eq!(c.ops, back.ops);
    }

    #[test]
    fn changes_ordered_by_hlc() {
        let hlc_early = Hlc::new(node1(), 1_000);
        let hlc_late = hlc_early.send(2_000);
        let early = Change::new(hlc_early, vec![]);
        let late = Change::new(hlc_late, vec![]);
        assert!(late.hlc > early.hlc);
    }
}
