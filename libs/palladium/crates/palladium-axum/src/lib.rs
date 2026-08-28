//! `palladium-axum` — HTTP/WebSocket server for the Palladium sync engine.
//!
//! Provides an [`axum`] router with REST endpoints for syncing [`Change`]s
//! between nodes. The router is generic over any [`ChangeStore`] backend.
//!
//! # Endpoints
//!
//! | Method | Path | Description |
//! |--------|------|-------------|
//! | `POST` | `/v1/changes` | Accept a single change from a client |
//! | `GET`  | `/v1/changes` | List bounded append-history page (`?cursor=`) |
//!
//! # Example
//!
//! ```rust,no_run
//! # // Concrete store provided by a storage crate.
//! use palladium_axum::{create_router, AppState};
//! use tower_http::cors::CorsLayer;
//!
//! # struct MyStore;
//! # impl palladium_core::ChangeStore for MyStore {
//! #     type Error = std::io::Error;
//! #     async fn insert<'a>(&'a self, _: &'a palladium_core::Scope, _: &'a palladium_core::Change) -> Result<palladium_core::InsertOutcome, std::io::Error> { Ok(palladium_core::InsertOutcome::Inserted(palladium_core::AppendCursor::new(1))) }
//! #     async fn page<'a>(&'a self, _: &'a palladium_core::Scope, _: Option<&'a palladium_core::AppendCursor>, _: u32) -> Result<palladium_core::ChangePage, std::io::Error> { Ok(palladium_core::ChangePage { version: 1, changes: vec![], purges: vec![], events: vec![], cursor: None, upper_bound: palladium_core::AppendCursor::new(1), caught_up: true, control: palladium_core::PageControl { must_refetch: false } }) }
//! #     async fn get<'a>(&'a self, _: &'a palladium_core::Scope, _: uuid::Uuid) -> Result<Option<palladium_core::Change>, std::io::Error> { Ok(None) }
//! # }
//! # async fn run() {
//! let state = AppState::new(MyStore);
//! let app = create_router(state, CorsLayer::permissive());
//! let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
//! axum::serve(listener, app).await.unwrap();
//! # }
//! ```

pub(crate) mod auth;
pub(crate) mod error;
pub(crate) mod routes;
pub(crate) mod state;

pub use auth::{AuthRejection, AuthScope, AuthSeam, BearerTokenSeam, StaticScopeSeam};
pub use error::{AppError, ErrorBody};
pub use routes::{create_router, ApiDoc};
pub use state::AppState;
