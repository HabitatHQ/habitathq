//! Top-level server configuration, parsed from `palladium.toml`.

use std::net::SocketAddr;

use crate::instance_config::InstanceConfig;

fn default_bind() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 8080))
}

/// Top-level server configuration.
///
/// Parsed from `palladium.toml` via `toml::from_str::<ServerConfig>(content)`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    /// TCP address to bind the HTTP server. Default: `127.0.0.1:8080`.
    #[serde(default = "default_bind")]
    pub bind: SocketAddr,

    /// Configured instances.
    #[serde(default)]
    pub instances: Vec<InstanceConfig>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: default_bind(),
            instances: Vec::new(),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_toml() {
        let cfg: ServerConfig = toml::from_str(
            r#"
            [[instances]]
            name = "main"
            path = "/tmp/main.db"
        "#,
        )
        .unwrap();
        assert_eq!(cfg.instances.len(), 1);
        assert_eq!(cfg.instances[0].name, "main");
        assert_eq!(cfg.instances[0].limits.pool_size, 5);
    }

    #[test]
    fn parse_empty_toml() {
        let cfg: ServerConfig = toml::from_str("").unwrap();
        assert!(cfg.instances.is_empty());
    }

    #[test]
    fn unknown_field_is_error() {
        let result: Result<ServerConfig, _> = toml::from_str(
            r#"
            [[instances]]
            name = "x"
            path = "/tmp/x.db"
            typo_field = true
        "#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn custom_bind_address() {
        let cfg: ServerConfig = toml::from_str(
            r#"
            bind = "0.0.0.0:9090"
        "#,
        )
        .unwrap();
        assert_eq!(cfg.bind.port(), 9090);
    }
}
