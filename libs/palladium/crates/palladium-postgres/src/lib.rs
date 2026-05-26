//! `palladium-postgres` — `PostgreSQL`-backed [`ChangeStore`] for the Palladium sync engine.
//!
//! Intended for use as the server-side authoritative store.
//!
//! # Example
//!
//! ```rust,no_run
//! use palladium_postgres::PostgresStore;
//! use palladium_core::{Change, ChangeStore};
//!
//! # async fn example() -> Result<(), palladium_postgres::Error> {
//! let store = PostgresStore::connect("postgres://localhost/palladium").await?;
//! # Ok(())
//! # }
//! ```

mod error;
mod store;

pub use error::{Error, Result};
pub use store::{validate_identifier, PostgresStore};
