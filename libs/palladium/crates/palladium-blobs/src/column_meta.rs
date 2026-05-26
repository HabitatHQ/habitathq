//! Runtime declaration of blob column metadata.
//!
//! This is the programmatic equivalent of what a future `#[blob(...)]` proc-macro
//! attribute will generate. Applications register [`BlobColumnMeta`] entries in a
//! [`BlobSchemaRegistry`] to declare which columns store blob references and how
//! those blobs should be handled.

use std::collections::HashMap;

/// The storage tier for a blob column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobStorage {
    /// Store the blob bytes inline in the row data (small blobs only).
    Inline,
    /// Store the blob in the `_blob_metadata` table with a [`crate::BlobRef`] in the column.
    BlobTable,
    /// Store the blob in an external [`crate::BlobStore`] (e.g. filesystem or S3).
    External,
}

/// Metadata about a single blob-typed column in an application schema.
///
/// Declare one of these per blob column and register it with a
/// [`BlobSchemaRegistry`] at application start-up.
#[derive(Debug, Clone)]
pub struct BlobColumnMeta {
    /// The name of the column that holds the blob reference.
    pub column_name: String,
    /// Where the blob bytes are physically stored.
    pub storage: BlobStorage,
    /// Whether changes to this column are written to the change log.
    pub log_changes: bool,
    /// Optional maximum blob size in mebibytes. `None` means unlimited.
    pub max_size_mb: Option<u64>,
}

/// A registry that maps table names to their blob column declarations.
///
/// # Example
///
/// ```rust
/// use palladium_blobs::column_meta::{BlobColumnMeta, BlobSchemaRegistry, BlobStorage};
///
/// let mut registry = BlobSchemaRegistry::default();
/// registry.register(
///     "documents",
///     BlobColumnMeta {
///         column_name: "attachment".into(),
///         storage: BlobStorage::External,
///         log_changes: true,
///         max_size_mb: Some(50),
///     },
/// );
/// let cols = registry.columns_for("documents");
/// assert_eq!(cols.len(), 1);
/// ```
#[derive(Debug, Default)]
pub struct BlobSchemaRegistry {
    inner: HashMap<String, Vec<BlobColumnMeta>>,
}

impl BlobSchemaRegistry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a blob column for `table`.
    ///
    /// Multiple columns can be registered for the same table by calling this
    /// method multiple times.
    pub fn register(&mut self, table: &str, meta: BlobColumnMeta) {
        self.inner
            .entry(table.to_owned())
            .or_default()
            .push(meta);
    }

    /// Return all blob column declarations for `table`.
    ///
    /// Returns an empty slice if `table` has no registered blob columns.
    #[must_use]
    pub fn columns_for(&self, table: &str) -> &[BlobColumnMeta] {
        self.inner.get(table).map_or(&[], Vec::as_slice)
    }

    /// Return the blob column declaration for a specific `column` in `table`,
    /// or `None` if not registered.
    #[must_use]
    pub fn get(&self, table: &str, column: &str) -> Option<&BlobColumnMeta> {
        self.columns_for(table)
            .iter()
            .find(|m| m.column_name == column)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn make_meta(name: &str) -> BlobColumnMeta {
        BlobColumnMeta {
            column_name: name.into(),
            storage: BlobStorage::External,
            log_changes: true,
            max_size_mb: Some(50),
        }
    }

    #[test]
    fn register_and_retrieve() {
        let mut reg = BlobSchemaRegistry::new();
        reg.register("documents", make_meta("attachment"));
        let cols = reg.columns_for("documents");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].column_name, "attachment");
    }

    #[test]
    fn unknown_table_returns_empty_slice() {
        let reg = BlobSchemaRegistry::new();
        assert!(reg.columns_for("nonexistent").is_empty());
    }

    #[test]
    fn multiple_columns_same_table() {
        let mut reg = BlobSchemaRegistry::new();
        reg.register("files", make_meta("thumbnail"));
        reg.register("files", make_meta("full_image"));
        assert_eq!(reg.columns_for("files").len(), 2);
    }

    #[test]
    fn get_specific_column() {
        let mut reg = BlobSchemaRegistry::new();
        reg.register("docs", make_meta("pdf"));
        reg.register("docs", make_meta("cover"));
        let col = reg.get("docs", "cover").unwrap();
        assert_eq!(col.column_name, "cover");
    }

    #[test]
    fn get_missing_column_returns_none() {
        let mut reg = BlobSchemaRegistry::new();
        reg.register("docs", make_meta("pdf"));
        assert!(reg.get("docs", "missing").is_none());
    }

    #[test]
    fn blob_storage_variants_eq() {
        assert_eq!(BlobStorage::Inline, BlobStorage::Inline);
        assert_ne!(BlobStorage::Inline, BlobStorage::External);
    }

    #[test]
    fn blob_column_meta_log_changes_and_max_size() {
        let meta = make_meta("data");
        assert!(meta.log_changes);
        assert_eq!(meta.max_size_mb, Some(50));
        assert_eq!(meta.storage, BlobStorage::External);
    }
}
