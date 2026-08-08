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
    /// client impersonate any user.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Opt in to binding a non-loopback `--host` with the dev bearer identity.
    /// Without this, Atrium refuses to start on a non-loopback address so it
    /// can't be exposed to an untrusted network by accident.
    #[arg(long)]
    insecure_allow_remote: bool,
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
    //
    // Fail closed: refuse a non-loopback bind unless the operator explicitly
    // opts in, so the dev identity can't be exposed by accident.
    // Fail closed on an obviously-remote host string before opening anything.
    if !is_loopback(&cli.host) && !cli.insecure_allow_remote {
        anyhow::bail!(
            "refusing to bind non-loopback host {host} with the dev bearer identity: \
             any reachable client could impersonate any user. Pass --insecure-allow-remote \
             to override on a trusted network (or use a verified identity provider).",
            host = cli.host,
        );
    }

    let db = AtriumDb::open(&cli.atrium_db).await?;
    let changes = SqliteStore::open(&cli.changes_db).await?;
    let state = AtriumState::new(db, changes, DevBearerProvider);
    let app = create_router(state, CorsLayer::permissive());

    // An IPv6 literal host (e.g. `::1`) must be bracketed in `host:port` form;
    // IPv4 and hostnames pass through unchanged.
    let addr = if cli.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", cli.host, cli.port)
    } else {
        format!("{}:{}", cli.host, cli.port)
    };
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    // Authoritatively validate the *resolved* bound address, not just the host
    // string: a hostname (or an unusual `/etc/hosts`) can map `localhost`/a name
    // to a non-loopback IP that the textual check above would wave through.
    let bound = listener.local_addr()?;
    if !bound.ip().is_loopback() {
        if !cli.insecure_allow_remote {
            anyhow::bail!(
                "refusing to serve on non-loopback address {bound} with the dev bearer identity: \
                 any reachable client could impersonate any user. Pass --insecure-allow-remote \
                 to override on a trusted network (or use a verified identity provider)."
            );
        }
        tracing::warn!(
            %bound,
            "serving the dev bearer identity on a NON-loopback address \
             (--insecure-allow-remote) — any reachable client can impersonate any user."
        );
    }

    info!(%bound, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
