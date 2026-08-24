//! `atrium` — dev server for the `HabitatHQ` backend (identity + tenancy + ACL).
//!
//! Uses the [`DevBearerProvider`] identity: `Authorization: Bearer <user_id>`.
//! Real Clerk JWKS verification is a later implementation of the same seam.

use anyhow::Result;
use atrium::{create_router, AtriumDb, AtriumState, DevBearerProvider, JwtJwksProvider};
use clap::Parser;
use tower_http::cors::CorsLayer;
use tracing::info;

/// Atrium dev server CLI.
#[derive(Debug, Parser)]
#[command(version, about)]
struct Cli {
    /// The unified Atrium tenancy, ACL, and changes database URL.
    #[arg(long, default_value = "sqlite:atrium.db", env = "ATRIUM_DB")]
    atrium_db: String,

    /// Port to listen on.
    #[arg(long, default_value_t = 4000)]
    port: u16,

    /// Address to bind. Defaults to loopback: the dev bearer identity treats
    /// the token as the user id, so a non-loopback bind lets any reachable
    /// client impersonate any user.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Legacy insecure override retained only to reject explicitly.
    #[arg(long)]
    insecure_allow_remote: bool,
    /// JWT issuer required for non-loopback serving.
    #[arg(long, env = "ATRIUM_JWT_ISSUER")]
    jwt_issuer: Option<String>,
    /// JWT audience required for non-loopback serving.
    #[arg(long, env = "ATRIUM_JWT_AUDIENCE")]
    jwt_audience: Option<String>,
    /// JWKS URL required for non-loopback serving.
    #[arg(long, env = "ATRIUM_JWKS_URL")]
    jwks_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    info!(
        atrium_db = %cli.atrium_db,
        port = cli.port,
        "starting atrium (dev bearer identity)"
    );

    if cli.insecure_allow_remote {
        anyhow::bail!("--insecure-allow-remote cannot enable unauthenticated remote serving");
    }

    // An IPv6 literal host (e.g. `::1`) must be bracketed in `host:port` form;
    // IPv4 and hostnames pass through unchanged.
    let addr = if cli.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", cli.host, cli.port)
    } else {
        format!("{}:{}", cli.host, cli.port)
    };
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let bound = listener.local_addr()?;
    let remote = !bound.ip().is_loopback();

    // Select identity from the resolved listener, not the requested host name:
    // host names may resolve differently than their text suggests.
    if remote && (cli.jwt_issuer.is_none() || cli.jwt_audience.is_none() || cli.jwks_url.is_none())
    {
        anyhow::bail!(
            "refusing to serve on non-loopback address {bound} without JWT issuer, audience, and JWKS URL"
        );
    }

    let db = AtriumDb::open(&cli.atrium_db).await?;
    let state = if remote {
        let provider = JwtJwksProvider::from_config(
            cli.jwt_issuer.as_deref().unwrap_or_default(),
            cli.jwt_audience.as_deref().unwrap_or_default(),
            cli.jwks_url.as_deref().unwrap_or_default(),
        )
        .await?;
        AtriumState::new(db, provider)
    } else {
        AtriumState::new(db, DevBearerProvider)
    };
    let app = create_router(state, CorsLayer::permissive());

    info!(%bound, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
