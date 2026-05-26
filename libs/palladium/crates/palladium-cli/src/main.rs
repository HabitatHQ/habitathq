//! `palladium` — developer CLI for the Palladium sync engine.
//!
//! # Usage
//!
//! ```text
//! palladium [--db <url>] <command>
//!
//! Commands:
//!   migrate        Run database schema migrations
//!   inspect        List changes stored in the database
//!   dev            Start a local development sync server
//!   instances list List configured instances and their status
//! ```

use anyhow::Result;
use clap::{Parser, Subcommand};
use palladium_axum::{AppState, create_router};
use palladium_core::{ChangeStore, ServerConfig};
use palladium_sqlite::SqliteStore;
use tower_http::cors::CorsLayer;
use tracing::info;

/// Palladium sync engine — developer CLI.
#[derive(Debug, Parser)]
#[command(version, about)]
struct Cli {
    /// `SQLite` database URL (default: `sqlite:palladium.db`).
    #[arg(long, default_value = "sqlite:palladium.db", env = "PALLADIUM_DB")]
    db: String,

    /// Subcommand to execute.
    #[command(subcommand)]
    command: Command,
}

/// Available CLI subcommands.
#[derive(Debug, Subcommand)]
enum Command {
    /// Run database schema migrations.
    Migrate,

    /// List changes stored in the database.
    Inspect {
        /// Maximum number of changes to display (0 = unlimited).
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },

    /// Start a local development sync server.
    Dev {
        /// Port to listen on.
        #[arg(long, default_value_t = 3000)]
        port: u16,

        /// Additional instances to serve as `name:path` (repeatable).
        /// When provided, overrides `--db` for multi-instance setups.
        #[arg(long = "instance", value_name = "NAME:PATH")]
        instances: Vec<InstanceArg>,
    },

    /// Manage configured instances.
    Instances {
        /// Instance sub-command.
        #[command(subcommand)]
        command: InstancesCommand,
    },
}

/// Sub-commands for `palladium instances`.
#[derive(Debug, Subcommand)]
enum InstancesCommand {
    /// List all configured instances and their status (read-only).
    List {
        /// Path to `palladium.toml` config file.
        #[arg(long, short = 'c')]
        config: Option<std::path::PathBuf>,

        /// Output as JSON instead of a human-readable table.
        #[arg(long)]
        json: bool,
    },
}

/// An `--instance name:path` CLI argument.
///
/// Parsed from a string of the form `name:path`. The path may itself
/// contain colons (e.g. `sqlite:/tmp/db`).
#[derive(Debug, Clone)]
struct InstanceArg {
    /// Instance name.
    name: String,
    /// Filesystem path or connection string.
    path: String,
}

impl std::str::FromStr for InstanceArg {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, String> {
        match s.split_once(':') {
            Some((name, path)) if !name.is_empty() && !path.is_empty() => Ok(Self {
                name: name.to_owned(),
                path: path.to_owned(),
            }),
            _ => Err(format!(
                "expected 'name:path' (e.g. 'main:/tmp/main.db'), got {s:?}"
            )),
        }
    }
}

async fn run_migrate(db_url: &str) -> Result<()> {
    info!(%db_url, "running migrations");
    SqliteStore::open(db_url).await?;
    info!("migrations complete");
    Ok(())
}

async fn run_inspect(db_url: &str, limit: usize) -> Result<()> {
    info!(%db_url, limit, "inspecting changes");
    let store = SqliteStore::open(db_url).await?;
    // Pass the limit directly to the store to avoid loading the entire table
    // into memory when only a few rows are needed.
    let store_limit = (limit > 0).then(|| u32::try_from(limit).unwrap_or(u32::MAX));
    let changes = store.list_after(None, store_limit).await?;
    for change in &changes {
        let json = serde_json::to_string_pretty(change)?;
        println!("{json}");
    }
    info!(count = changes.len(), "done");
    Ok(())
}

async fn run_dev(db_url: &str, port: u16, extra_instances: &[InstanceArg]) -> Result<()> {
    // If --instance flags were provided, log them (future: open all and serve).
    for inst in extra_instances {
        info!(name = %inst.name, path = %inst.path, "configured additional instance");
    }
    info!(%db_url, port, "starting dev server");
    let store = SqliteStore::open(db_url).await?;
    let state = AppState::new(store);
    let app = create_router(state, CorsLayer::permissive());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(%addr, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Load `ServerConfig` from an optional TOML file path.
fn load_config(config_path: Option<&std::path::Path>) -> Result<ServerConfig> {
    match config_path {
        Some(p) => {
            let raw = std::fs::read_to_string(p)?;
            Ok(toml::from_str::<ServerConfig>(&raw)?)
        }
        None => Ok(ServerConfig::default()),
    }
}

/// Status record for one instance used by `instances list`.
#[derive(Debug, serde::Serialize)]
struct InstanceListEntry {
    name: String,
    path: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn run_instances_list(config_path: Option<&std::path::Path>, json: bool) -> Result<()> {
    let cfg = load_config(config_path)?;

    if cfg.instances.is_empty() {
        println!("No instances configured.");
        return Ok(());
    }

    let mut entries: Vec<InstanceListEntry> = Vec::new();
    for inst in &cfg.instances {
        let entry = match SqliteStore::open(&inst.path).await {
            Ok(_store) => InstanceListEntry {
                name: inst.name.clone(),
                path: inst.path.clone(),
                status: "ok".to_owned(),
                error: None,
            },
            Err(e) => InstanceListEntry {
                name: inst.name.clone(),
                path: inst.path.clone(),
                status: "error".to_owned(),
                error: Some(e.to_string()),
            },
        };
        entries.push(entry);
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
    } else {
        // Simple tabular output
        println!("{:<20} {:<40} STATUS", "NAME", "PATH");
        for e in &entries {
            let status = e.error.as_ref().map_or_else(
                || e.status.clone(),
                |err| format!("error: {err}"),
            );
            println!("{:<20} {:<40} {status}", e.name, e.path);
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    match cli.command {
        Command::Migrate => run_migrate(&cli.db).await,
        Command::Inspect { limit } => run_inspect(&cli.db, limit).await,
        Command::Dev { port, instances } => run_dev(&cli.db, port, &instances).await,
        Command::Instances {
            command: InstancesCommand::List { config, json },
        } => run_instances_list(config.as_deref(), json).await,
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{Cli, Command, InstanceArg, InstancesCommand};

    #[test]
    fn parse_migrate_default_db() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "migrate"]).unwrap();
        assert_eq!(cli.db, "sqlite:palladium.db");
        assert!(matches!(cli.command, Command::Migrate));
    }

    #[test]
    fn parse_migrate_custom_db() {
        #[allow(clippy::unwrap_used)]
        let cli =
            Cli::try_parse_from(["palladium", "--db", "sqlite:/tmp/test.db", "migrate"]).unwrap();
        assert_eq!(cli.db, "sqlite:/tmp/test.db");
        assert!(matches!(cli.command, Command::Migrate));
    }

    #[test]
    fn parse_inspect_default_limit() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "inspect"]).unwrap();
        assert!(matches!(cli.command, Command::Inspect { limit: 20 }));
    }

    #[test]
    fn parse_inspect_custom_limit() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "inspect", "--limit", "5"]).unwrap();
        assert!(matches!(cli.command, Command::Inspect { limit: 5 }));
    }

    #[test]
    fn parse_dev_default_port() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "dev"]).unwrap();
        assert!(matches!(cli.command, Command::Dev { port: 3000, .. }));
    }

    #[test]
    fn parse_dev_custom_port() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "dev", "--port", "8080"]).unwrap();
        assert!(matches!(cli.command, Command::Dev { port: 8080, .. }));
    }

    #[test]
    fn unknown_command_returns_error() {
        assert!(Cli::try_parse_from(["palladium", "unknown"]).is_err());
    }

    // ── InstanceArg parsing ───────────────────────────────────────────────

    #[test]
    fn instance_arg_parses_name_and_path() {
        #[allow(clippy::unwrap_used)]
        let a: InstanceArg = "main:/tmp/main.db".parse().unwrap();
        assert_eq!(a.name, "main");
        assert_eq!(a.path, "/tmp/main.db");
    }

    #[test]
    fn instance_arg_path_may_contain_colons() {
        #[allow(clippy::unwrap_used)]
        let a: InstanceArg = "db:sqlite:/tmp/x.db".parse().unwrap();
        assert_eq!(a.name, "db");
        assert_eq!(a.path, "sqlite:/tmp/x.db");
    }

    #[test]
    fn instance_arg_missing_colon_is_error() {
        assert!("invalid".parse::<InstanceArg>().is_err());
    }

    #[test]
    fn instance_arg_empty_name_is_error() {
        assert!(":/tmp/x.db".parse::<InstanceArg>().is_err());
    }

    #[test]
    fn instance_arg_empty_path_is_error() {
        assert!("name:".parse::<InstanceArg>().is_err());
    }

    // ── instances list subcommand ─────────────────────────────────────────

    #[test]
    fn parse_instances_list_minimal() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "instances", "list"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Instances {
                command: InstancesCommand::List { json: false, .. }
            }
        ));
    }

    #[test]
    fn parse_instances_list_json_flag() {
        #[allow(clippy::unwrap_used)]
        let cli = Cli::try_parse_from(["palladium", "instances", "list", "--json"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Instances {
                command: InstancesCommand::List { json: true, .. }
            }
        ));
    }
}
