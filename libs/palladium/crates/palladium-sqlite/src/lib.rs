//! `palladium-sqlite` — SQLite-backed [`ChangeStore`] for the Palladium sync engine.
//!
//! Intended for use as a local embedded store on client devices.
//!
//! # Example
//!
//! ```rust,no_run
//! use palladium_sqlite::SqliteStore;
//! use palladium_core::{Change, ChangeStore, Hlc, NodeId};
//!
//! # async fn example() -> Result<(), palladium_sqlite::Error> {
//! let store = SqliteStore::open("sqlite:palladium.db").await?;
//! # Ok(())
//! # }
//! ```

mod error;
mod store;

pub use error::{Error, Result};
pub use store::SqliteStore;
