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

    /// Scope-qualified data file; hashing prevents scope traversal and collisions.
    fn blob_path(&self, scope: &str, id: BlobId) -> PathBuf {
        use sha2::Digest;
        let scope_key = sha2::Sha256::digest(scope.as_bytes());
        self.root
            .join(format!("{scope_key:x}"))
            .join(id.to_string())
    }

    fn tombstone_path(&self, scope: &str, id: BlobId) -> PathBuf {
        self.blob_path(scope, id).with_extension("tombstone")
    }

    /// Remove the bytes of all blobs that have been soft-deleted.
    ///
    /// # Errors
    ///
    /// Returns an error if any file removal fails.
    pub async fn purge_deleted(&self) -> Result<(), BlobError> {
        let mut scopes = match fs::read_dir(&self.root).await {
            Ok(scopes) => scopes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(BlobError::Io(error)),
        };
        while let Some(scope_entry) = scopes.next_entry().await? {
            let entry_type = scope_entry.file_type().await?;
            if !entry_type.is_dir() {
                if entry_type.is_file()
                    && scope_entry
                        .file_name()
                        .to_str()
                        .and_then(|name| name.strip_suffix(".tombstone"))
                        .is_some_and(|id| id.parse::<uuid::Uuid>().is_ok())
                {
                    let marker = scope_entry.path();
                    let blob = marker.with_extension("");
                    if fs::try_exists(&blob).await? {
                        fs::remove_file(blob).await?;
                    }
                    fs::remove_file(marker).await?;
                }
                continue;
            }
            let mut files = fs::read_dir(scope_entry.path()).await?;
            while let Some(entry) = files.next_entry().await? {
                if entry.file_name().to_string_lossy().ends_with(".tombstone") {
                    let blob = entry.path().with_extension("");
                    if fs::try_exists(&blob).await? {
                        fs::remove_file(blob).await?;
                    }
                    fs::remove_file(entry.path()).await?;
                }
            }
        }
        Ok(())
    }
}

impl BlobStore for FilesystemBlobStore {
    async fn put(&self, scope: &str, id: BlobId, data: &[u8]) -> Result<(), BlobError> {
        if fs::try_exists(self.tombstone_path(scope, id)).await? {
            return Err(BlobError::NotFound(id));
        }
        let path = self.blob_path(scope, id);
        fs::create_dir_all(path.parent().unwrap_or(&self.root)).await?;
        fs::write(path, data).await?;
        Ok(())
    }

    async fn get(&self, scope: &str, id: BlobId) -> Result<Vec<u8>, BlobError> {
        if fs::try_exists(self.tombstone_path(scope, id)).await? {
            return Err(BlobError::NotFound(id));
        }
        match fs::read(self.blob_path(scope, id)).await {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(BlobError::NotFound(id)),
            Err(e) => Err(BlobError::Io(e)),
        }
    }

    async fn delete(&self, scope: &str, id: BlobId) -> Result<(), BlobError> {
        if !fs::try_exists(self.blob_path(scope, id)).await?
            || fs::try_exists(self.tombstone_path(scope, id)).await?
        {
            return Err(BlobError::NotFound(id));
        }
        let tombstone = self.tombstone_path(scope, id);
        fs::write(&tombstone, b"").await?;
        Ok(())
    }

    async fn exists(&self, scope: &str, id: BlobId) -> Result<bool, BlobError> {
        Ok(fs::try_exists(self.blob_path(scope, id)).await?
            && !fs::try_exists(self.tombstone_path(scope, id)).await?)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scoped_blobs_are_isolated_and_legacy_paths_are_not_read() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        fs::write(dir.path().join(id.to_string()), b"legacy bytes")
            .await
            .unwrap();
        store.put("alice", id, b"alice bytes").await.unwrap();
        store.put("bob", id, b"bob bytes").await.unwrap();
        assert_eq!(store.get("alice", id).await.unwrap(), b"alice bytes");
        assert_eq!(store.get("bob", id).await.unwrap(), b"bob bytes");
        assert!(!store.exists("unknown", id).await.unwrap());
        assert!(matches!(
            store.get("unknown", id).await,
            Err(BlobError::NotFound(_))
        ));
        assert_eq!(
            fs::read(dir.path().join(id.to_string())).await.unwrap(),
            b"legacy bytes"
        );
    }

    #[tokio::test]
    async fn delete_and_purge_are_scoped() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let id = uuid::Uuid::new_v4();
        store.put("alice", id, b"alice").await.unwrap();
        store.put("bob", id, b"bob").await.unwrap();
        store.delete("alice", id).await.unwrap();
        assert!(!store.exists("alice", id).await.unwrap());
        assert_eq!(store.get("bob", id).await.unwrap(), b"bob");
        store.purge_deleted().await.unwrap();
        assert!(!store.blob_path("alice", id).exists());
        assert_eq!(store.get("bob", id).await.unwrap(), b"bob");
    }

    #[tokio::test]
    async fn purge_removes_legacy_uuid_tombstones_but_preserves_unmarked_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = FilesystemBlobStore::new(dir.path());
        let deleted = uuid::Uuid::new_v4();
        let retained = uuid::Uuid::new_v4();
        let marker = dir.path().join(format!("{deleted}.tombstone"));
        let deleted_path = dir.path().join(deleted.to_string());
        let retained_path = dir.path().join(retained.to_string());
        fs::write(&deleted_path, b"deleted bytes").await.unwrap();
        fs::write(&marker, b"").await.unwrap();
        fs::write(&retained_path, b"legacy bytes").await.unwrap();

        store.purge_deleted().await.unwrap();

        assert!(!fs::try_exists(deleted_path).await.unwrap());
        assert!(!fs::try_exists(marker).await.unwrap());
        assert_eq!(fs::read(retained_path).await.unwrap(), b"legacy bytes");
    }
}
