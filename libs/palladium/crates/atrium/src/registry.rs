//! Sharing registry — which app tables are aggregate roots vs children.
//!
//! ACL is set on **roots**; **children** inherit their root's ACL through a
//! `root_id` field in the inserted row (`D21`, §7.1). This registry describes
//! the burrow POC schema; a real app would supply its own.

/// How a root table may be shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shareable {
    /// Never shareable — always private to its owner (e.g. `habits`).
    PrivateOnly,
    /// Shareable workspace-wide (e.g. `lists`).
    Household,
    /// Shareable with specific members (e.g. `notes`).
    PerMember,
}

/// A table's role in the sync/ACL model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableRole {
    /// An aggregate root that owns an ACL, with its sharing capability.
    Root(Shareable),
    /// A child that inherits its root's ACL (its row carries `root_id`).
    Child,
}

/// The role of `table` in the burrow POC schema, or `None` if unknown.
#[must_use]
pub fn role_of(table: &str) -> Option<TableRole> {
    Some(match table {
        "habits" => TableRole::Root(Shareable::PrivateOnly),
        "lists" => TableRole::Root(Shareable::Household),
        "notes" => TableRole::Root(Shareable::PerMember),
        "completions" | "list_items" | "note_images" => TableRole::Child,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{role_of, Shareable, TableRole};

    #[test]
    fn known_roots_and_children() {
        assert_eq!(
            role_of("habits"),
            Some(TableRole::Root(Shareable::PrivateOnly))
        );
        assert_eq!(
            role_of("lists"),
            Some(TableRole::Root(Shareable::Household))
        );
        assert_eq!(
            role_of("notes"),
            Some(TableRole::Root(Shareable::PerMember))
        );
        assert_eq!(role_of("list_items"), Some(TableRole::Child));
        assert_eq!(role_of("unknown"), None);
    }
}
