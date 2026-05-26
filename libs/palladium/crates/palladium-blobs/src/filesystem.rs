//! Filesystem-backed [`BlobStore`] implementation.

use std::path::PathBuf;

use tokio::fs;

use crate::{BlobError, BlobId, BlobStore};

/// A [`BlobStore`] that persists blobs as files under a root directory.
///
/// Soft-delete is implemented by creating a `{id}.tombstone` sibling file.
/// The original bytes are not removed until [`FilesystemBlobStore::purge_deleted`]
/// is called.
pub struct FilesystemBlobStore {
    root: PathBuf,
}

impl FilesystemBlobStore {
    /// Create a new store rooted at `root`.
    ///
    /// The directory is created if it does not already exist when the first
    /// blob is written.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Path for the blob data file.
    fn blob_path(&self, id: BlobId) -> PathBuf {
        self.root.join(id.to_string())
    }

    /// Path for the tombstone marker file used to implement soft-delete.
    fn tombstone_path(&self, id: BlobId) -> PathBuf {
        self.root.join(format!("{id}.tombstone"))
    }

    /// Remove the bytes of all blobs that have been soft-deleted.
    ///
    /// # Errors
    ///
    /// Returns an error if any file removal fails.
    pub async fn purge_deleted(&self) -> Result<(), BlobError> {
        let mut dir = fs::read_dir(&self.root).await?;
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_owned();
            if let Some(id_str) = name.strip_suffix(".tombstone") {
                // Parse the UUID; skip non-UUID filenames gracefully.
                if let Ok(id) = id_str.parse::<BlobId>() {
                    let blob = self.blob_path(id);
                    if blob.exists() {
                        fs::remove_file(&blob).await?;
                    }
                    fs::remove_file(&path).await?;
                }
            }
        }
        Ok(())
    }
}

impl BlobStore for FilesystemBlobStore {
    async fn put(&self, id: BlobId, data: &[u8]) -> Result<(), BlobError> {
        fs::create_dir_all(&self.root).await?;
        fs::write(self.blob_path(id), data).await?;
        Ok(())
    }

    async fn get(&self, id: BlobId) -> Result<Vec<u8>, BlobError> {
        let tombstone = self.tombstone_path(id);
        if tombstone.exists() {
            return Err(BlobError::NotFound(id));
        }
        let path = self.blob_path(id);
        match fs::read(&path).await {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(BlobError::NotFound(id))
            }
            Err(e) => Err(BlobError::Io(e)),
        }
    }

    async fn delete(&self, id: BlobId) -> Result<(), BlobError> {
        // Check blob exists and is not already deleted.
        if !self.blob_path(id).exists() || self.tombstone_path(id).exists() {
            return Err(BlobError::NotFound(id));
        }
        fs::write(self.tombstone_path(id), b"").await?;
        Ok(())
    }

    async fn exists(&self, id: BlobId) -> Result<bool, BlobError> {
        Ok(self.blob_path(id).exists() && !self.tombstone_path(id).exists())
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn put_get_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put(id, b"hello blobs").await.unwrap();
        let got = store.get(id).await.unwrap();
        assert_eq!(got, b"hello blobs");
    }

    #[tokio::test]
    async fn get_missing_returns_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        let err = store.get(id).await.unwrap_err();
        assert!(matches!(err, BlobError::NotFound(_)));
    }

    #[tokio::test]
    async fn delete_marks_as_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put(id, b"data").await.unwrap();
        store.delete(id).await.unwrap();
        // Tombstone should exist
        assert!(store.tombstone_path(id).exists());
    }

    #[tokio::test]
    async fn get_after_delete_returns_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put(id, b"data").await.unwrap();
        store.delete(id).await.unwrap();
        let err = store.get(id).await.unwrap_err();
        assert!(matches!(err, BlobError::NotFound(_)));
    }

    #[tokio::test]
    async fn exists_true_before_delete_false_after() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put(id, b"data").await.unwrap();
        assert!(store.exists(id).await.unwrap());
        store.delete(id).await.unwrap();
        assert!(!store.exists(id).await.unwrap());
    }

    #[tokio::test]
    async fn purge_deleted_removes_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put(id, b"data").await.unwrap();
        store.delete(id).await.unwrap();
        store.purge_deleted().await.unwrap();
        // Both data file and tombstone should be gone.
        assert!(!store.blob_path(id).exists());
        assert!(!store.tombstone_path(id).exists());
    }
}
