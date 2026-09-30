//! `atrium` — dev server for the `HabitatHQ` backend.
use anyhow::Result;
use atrium::{create_router, AtriumDb, AtriumState, DevBearerProvider, JwtJwksProvider};
use clap::{Parser, ValueEnum};
use tower_http::cors::CorsLayer;
use tracing::info;

#[derive(Debug, Clone, Copy, Default, ValueEnum)]
enum AuthMode {
    #[default]
    Oidc,
    Dev,
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
    #[arg(
        long,
        env = "ATRIUM_AUTH_MODE",
        value_enum,
        default_value_t = AuthMode::Oidc
    )]
    auth_mode: AuthMode,
    #[arg(long, env = "ATRIUM_OIDC_ISSUER")]
    oidc_issuer: Option<String>,
    #[arg(long, env = "ATRIUM_OIDC_AUDIENCE")]
    oidc_audience: Option<String>,
    #[arg(long, env = "ATRIUM_OIDC_DISCOVERY_URL")]
    oidc_discovery_url: Option<String>,
}

fn require_dev_loopback(mode: AuthMode, bound: std::net::SocketAddr) -> Result<()> {
    if matches!(mode, AuthMode::Dev) && !bound.ip().is_loopback() {
        anyhow::bail!("development bearer authentication is restricted to loopback listeners");
    }
    Ok(())
}
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    let addr = if cli.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", cli.host, cli.port)
    } else {
        format!("{}:{}", cli.host, cli.port)
    };
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let bound = listener.local_addr()?;
    require_dev_loopback(cli.auth_mode, bound)?;
    let db = AtriumDb::open(&cli.atrium_db).await?;
    let state = match cli.auth_mode {
        AuthMode::Oidc => {
            let issuer = cli
                .oidc_issuer
                .ok_or_else(|| anyhow::anyhow!("ATRIUM_OIDC_ISSUER is required"))?;
            let audience = cli
                .oidc_audience
                .ok_or_else(|| anyhow::anyhow!("ATRIUM_OIDC_AUDIENCE is required"))?;
            let discovery = cli
                .oidc_discovery_url
                .ok_or_else(|| anyhow::anyhow!("ATRIUM_OIDC_DISCOVERY_URL is required"))?;
            AtriumState::new(
                db,
                JwtJwksProvider::from_config(issuer, audience, &discovery).await?,
            )
        }
        AuthMode::Dev => AtriumState::new(db, DevBearerProvider),
    };
    info!(%bound,"listening");
    axum::serve(listener, create_router(state, CorsLayer::permissive())).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{require_dev_loopback, AuthMode, Cli};
    use clap::Parser;

    #[test]
    fn oidc_is_the_default_auth_mode() -> anyhow::Result<()> {
        let cli = Cli::try_parse_from(["atrium"])?;
        assert!(matches!(cli.auth_mode, AuthMode::Oidc));
        Ok(())
    }

    #[test]
    fn development_auth_requires_an_explicit_loopback_configuration() -> anyhow::Result<()> {
        let cli = Cli::try_parse_from(["atrium", "--auth-mode", "dev"])?;
        assert!(matches!(cli.auth_mode, AuthMode::Dev));
        assert!(require_dev_loopback(AuthMode::Dev, "127.0.0.1:4000".parse()?).is_ok());
        assert!(require_dev_loopback(AuthMode::Dev, "[::1]:4000".parse()?).is_ok());
        assert!(require_dev_loopback(AuthMode::Dev, "0.0.0.0:4000".parse()?).is_err());
        Ok(())
    }
}
