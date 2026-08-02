//! `atrium` — dev server for the `HabitatHQ` backend (identity + tenancy + ACL).
//!
//! Uses the [`DevBearerProvider`] identity: `Authorization: Bearer <user_id>`.
//! Real Clerk JWKS verification is a later implementation of the same seam.

use anyhow::Result;
use atrium::{create_router, AtriumDb, AtriumState, DevBearerProvider};
use clap::Parser;
use palladium_sqlite::SqliteStore;
use tower_http::cors::CorsLayer;
use tracing::info;

/// Atrium dev server CLI.
#[derive(Debug, Parser)]
#[command(version, about)]
struct Cli {
    /// Atrium's tenancy/ACL database URL.
    #[arg(long, default_value = "sqlite:atrium.db", env = "ATRIUM_DB")]
    atrium_db: String,

    /// The embedded Palladium change-store database URL.
    #[arg(long, default_value = "sqlite:atrium-changes.db", env = "ATRIUM_CHANGES_DB")]
    changes_db: String,

    /// Port to listen on.
    #[arg(long, default_value_t = 4000)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    info!(
        atrium_db = %cli.atrium_db,
        changes_db = %cli.changes_db,
        port = cli.port,
        "starting atrium (dev bearer identity)"
    );

    let db = AtriumDb::open(&cli.atrium_db).await?;
    let changes = SqliteStore::open(&cli.changes_db).await?;
    let state = AtriumState::new(db, changes, DevBearerProvider);
    let app = create_router(state, CorsLayer::permissive());

    let addr = format!("0.0.0.0:{}", cli.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(%addr, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
