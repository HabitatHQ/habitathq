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

    /// Address to bind. Defaults to loopback: the dev bearer identity treats
    /// the token as the user id, so a non-loopback bind lets any reachable
    /// client impersonate any user. Only widen this on a trusted network.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
}

/// Whether `host` names a loopback interface (safe for the dev identity).
fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "::1")
        || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
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

    // TODO(clerk): `DevBearerProvider` trusts the bearer *as* the user id, so it
    // must never face an untrusted network. Once the ClerkProvider (JWKS verify)
    // lands, select it via a `--auth clerk` flag for non-loopback binds.
    if !is_loopback(&cli.host) {
        tracing::warn!(
            host = %cli.host,
            "binding a NON-loopback address with the dev bearer identity — any \
             reachable client can impersonate any user. Use only on a trusted network."
        );
    }

    let db = AtriumDb::open(&cli.atrium_db).await?;
    let changes = SqliteStore::open(&cli.changes_db).await?;
    let state = AtriumState::new(db, changes, DevBearerProvider);
    let app = create_router(state, CorsLayer::permissive());

    let addr = format!("{}:{}", cli.host, cli.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(%addr, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
