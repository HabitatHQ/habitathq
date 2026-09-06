//! `atrium` — dev server for the `HabitatHQ` backend.
use anyhow::Result;
use atrium::{create_router, AtriumDb, AtriumState, DevBearerProvider, JwtJwksProvider};
use clap::{Parser, ValueEnum};
use tower_http::cors::CorsLayer;
use tracing::info;

#[derive(Clone, Debug, ValueEnum)]
enum AuthMode {
    Dev,
    Oidc,
}
#[derive(Debug, Parser)]
#[command(version, about)]
struct Cli {
    #[arg(long, default_value = "sqlite:atrium.db", env = "ATRIUM_DB")]
    atrium_db: String,
    #[arg(long, default_value_t = 4000)]
    port: u16,
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long)]
    insecure_allow_remote: bool,
    #[arg(long, value_enum, default_value_t = AuthMode::Oidc)]
    auth_mode: AuthMode,
    #[arg(long, env = "ATRIUM_OIDC_ISSUER")]
    oidc_issuer: Option<String>,
    #[arg(long, env = "ATRIUM_OIDC_AUDIENCE")]
    oidc_audience: Option<String>,
    #[arg(long, env = "ATRIUM_OIDC_DISCOVERY_URL")]
    oidc_discovery_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    if cli.insecure_allow_remote {
        anyhow::bail!("--insecure-allow-remote cannot enable unauthenticated remote serving");
    }
    let addr = if cli.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", cli.host, cli.port)
    } else {
        format!("{}:{}", cli.host, cli.port)
    };
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let bound = listener.local_addr()?;
    let db = AtriumDb::open(&cli.atrium_db).await?;
    let state = match cli.auth_mode {
        AuthMode::Dev => {
            if !bound.ip().is_loopback() {
                anyhow::bail!("--auth-mode dev requires a loopback listener");
            }
            AtriumState::new(db, DevBearerProvider)
        }
        AuthMode::Oidc => {
            let issuer = cli.oidc_issuer.ok_or_else(|| {
                anyhow::anyhow!("ATRIUM_OIDC_ISSUER is required for OIDC serving")
            })?;
            let audience = cli.oidc_audience.ok_or_else(|| {
                anyhow::anyhow!("ATRIUM_OIDC_AUDIENCE is required for OIDC serving")
            })?;
            let discovery = cli.oidc_discovery_url.ok_or_else(|| {
                anyhow::anyhow!("ATRIUM_OIDC_DISCOVERY_URL is required for OIDC serving")
            })?;
            AtriumState::new(
                db,
                JwtJwksProvider::from_config(issuer, audience, &discovery).await?,
            )
        }
    };
    info!(%bound,"listening");
    axum::serve(listener, create_router(state, CorsLayer::permissive())).await?;
    Ok(())
}
