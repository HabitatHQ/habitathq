//! Row-level operations that form the delta model.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single row-level operation against a named table.
///
/// Operations are the atomic unit of the delta model. A [`crate::Change`]
/// groups one or more `Op`s into a causally-stamped batch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
#[non_exhaustive]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Op {
    /// Insert a new row.
    Insert {
        /// Name of the target table.
        table: String,
        /// Client-assigned row identifier.
        row_id: Uuid,
        /// Full row data serialised as a JSON object.
        #[cfg_attr(feature = "openapi", schema(value_type = Object))]
        data: serde_json::Value,
    },
    /// Update a single column of an existing row.
    Update {
        /// Name of the target table.
        table: String,
        /// Row to update.
        row_id: Uuid,
        /// Column to set.
        col: String,
        /// New column value.
        #[cfg_attr(feature = "openapi", schema(value_type = Object))]
        value: serde_json::Value,
    },
    /// Delete a row.
    Delete {
        /// Name of the target table.
        table: String,
        /// Row to remove.
        row_id: Uuid,
    },
}

impl Op {
    /// Returns the name of the table this operation targets.
    #[must_use]
    pub fn table(&self) -> &str {
        match self {
            Self::Insert { table, .. }
            | Self::Update { table, .. }
            | Self::Delete { table, .. } => table,
        }
    }

    /// Returns the row identifier this operation targets.
    #[must_use]
    pub const fn row_id(&self) -> Uuid {
        match self {
            Self::Insert { row_id, .. }
            | Self::Update { row_id, .. }
            | Self::Delete { row_id, .. } => *row_id,
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use serde_json::json;
    use uuid::Uuid;

    use super::Op;

    fn row() -> Uuid {
        Uuid::nil()
    }

    #[test]
    fn insert_table_and_row_id() {
        let op = Op::Insert {
            table: "users".into(),
            row_id: row(),
            data: json!({"name": "Alice"}),
        };
        assert_eq!(op.table(), "users");
        assert_eq!(op.row_id(), row());
    }

    #[test]
    fn update_table_and_row_id() {
        let op = Op::Update {
            table: "users".into(),
            row_id: row(),
            col: "name".into(),
            value: json!("Bob"),
        };
        assert_eq!(op.table(), "users");
        assert_eq!(op.row_id(), row());
    }

    #[test]
    fn delete_table_and_row_id() {
        let op = Op::Delete {
            table: "users".into(),
            row_id: row(),
        };
        assert_eq!(op.table(), "users");
        assert_eq!(op.row_id(), row());
    }

    #[test]
    fn insert_serde_round_trip() {
        let op = Op::Insert {
            table: "todos".into(),
            row_id: Uuid::new_v4(),
            data: json!({"text": "buy milk", "done": false}),
        };
        let json = serde_json::to_string(&op).unwrap();
        let back: Op = serde_json::from_str(&json).unwrap();
        assert_eq!(op, back);
    }

    #[test]
    fn update_serde_round_trip() {
        let op = Op::Update {
            table: "todos".into(),
            row_id: Uuid::new_v4(),
            col: "done".into(),
            value: json!(true),
        };
        let json = serde_json::to_string(&op).unwrap();
        let back: Op = serde_json::from_str(&json).unwrap();
        assert_eq!(op, back);
    }

    #[test]
    fn delete_serde_round_trip() {
        let op = Op::Delete {
            table: "todos".into(),
            row_id: Uuid::new_v4(),
        };
        let json = serde_json::to_string(&op).unwrap();
        let back: Op = serde_json::from_str(&json).unwrap();
        assert_eq!(op, back);
    }

    #[test]
    fn insert_has_op_tag_in_json() {
        let op = Op::Insert {
            table: "t".into(),
            row_id: row(),
            data: json!({}),
        };
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains(r#""op":"insert""#));
    }

    #[test]
    fn delete_has_op_tag_in_json() {
        let op = Op::Delete {
            table: "t".into(),
            row_id: row(),
        };
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains(r#""op":"delete""#));
    }
}
