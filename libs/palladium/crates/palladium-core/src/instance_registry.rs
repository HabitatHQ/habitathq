//! Process-global registry preventing duplicate [`SqliteStore`] / [`PostgresStore`]
//! opens on the same canonical path.

use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};

use crate::{Error, Result};

static OPEN_PATHS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn with_set<T>(f: impl FnOnce(&mut HashSet<String>) -> T) -> T {
    let mutex = OPEN_PATHS.get_or_init(|| Mutex::new(HashSet::new()));
    // Mutex poison only happens when a thread panics while holding it.
    // Since this crate denies `panic`, we recover gracefully.
    let mut guard = mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    f(&mut guard)
}

/// Attempt to register `canonical_path` as open.
///
/// Returns `Ok(OpenGuard)` on success; `Err(Error::InstanceAlreadyOpen)` if
/// the path is already registered in this process.
///
/// # Errors
/// Returns [`Error::InstanceAlreadyOpen`] if the path is already registered.
pub fn register(canonical_path: impl Into<String>) -> Result<OpenGuard> {
    let path = canonical_path.into();
    with_set(|set| {
        if set.contains(&path) {
            Err(Error::InstanceAlreadyOpen(path))
        } else {
            set.insert(path.clone());
            Ok(OpenGuard { path })
        }
    })
}

/// RAII guard: deregisters the path when dropped.
///
/// Returned by [`register`]. Hold this for the lifetime of the engine instance.
#[must_use]
#[derive(Debug)]
pub struct OpenGuard {
    path: String,
}

impl Drop for OpenGuard {
    fn drop(&mut self) {
        if let Some(mutex) = OPEN_PATHS.get() {
            if let Ok(mut guard) = mutex.lock() {
                guard.remove(&self.path);
            }
        }
    }
}

impl std::fmt::Display for OpenGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "OpenGuard({})", self.path)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn unique_path() -> String {
        format!("test-registry-{}", uuid::Uuid::new_v4())
    }

    #[test]
    fn register_same_path_twice_is_error() {
        let path = unique_path();
        let _g = register(path.clone()).unwrap();
        let err = register(path).unwrap_err();
        assert!(matches!(err, crate::Error::InstanceAlreadyOpen(_)));
    }

    #[test]
    fn register_different_paths_succeeds() {
        let _g1 = register(unique_path()).unwrap();
        let _g2 = register(unique_path()).unwrap();
    }

    #[test]
    fn re_register_after_drop_succeeds() {
        let path = unique_path();
        {
            let _g = register(path.clone()).unwrap();
        }
        let _g2 = register(path).unwrap();
    }
}
