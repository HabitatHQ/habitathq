//! Docker-gated OIDC provider-boundary coverage for Atrium.
//!
//! # Running
//!
//! ```sh
//! cargo test -p atrium --features oidc-testcontainers --test oidc_testcontainers
//! ```
//!
//! Requires a running Docker daemon. This test deliberately uses the pinned
//! `mock-oauth2-server` image rather than booting Authentik's full 2026.8.1
//! server, worker, PostgreSQL, Redis, and bootstrap topology. The fixture is a
//! standards-compatible OIDC issuer: it publishes discovery and JWKS documents
//! and issues its own RS256 access tokens. Atrium receives only its published
//! discovery URL, exactly as it does for Authentik.

#![cfg(feature = "oidc-testcontainers")]
#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use serde::Deserialize;
use std::{net::TcpListener, path::PathBuf, process::Stdio, time::Duration};
use testcontainers::{
    core::{ContainerPort, WaitFor},
    runners::AsyncRunner,
    GenericImage, ImageExt,
};
use tokio::{process::Command, time::timeout};
const MOCK_OIDC_IMAGE: &str = "ghcr.io/navikt/mock-oauth2-server";
const MOCK_OIDC_TAG: &str = "4.0.0";
const OIDC_PORT: ContainerPort = ContainerPort::Tcp(8080);
const AUDIENCE: &str = "atrium";
const ISSUER_ID: &str = "default";

// Each token is issued by the same OIDC issuer and signed with its published
// JWKS key. This lets the negative cases isolate audience and expiry validation
// instead of failing because the issuer or signing key changed.
const MOCK_OIDC_CONFIG: &str = r#"{
  "tokenCallbacks": [
    {
      "issuerId": "default",
      "tokenExpiry": 600,
      "requestMappings": [{
        "requestParam": "scope",
        "match": "atrium-valid",
        "claims": { "sub": "atrium-user", "aud": ["atrium"] }
      }]
    },
    {
      "issuerId": "default",
      "tokenExpiry": 600,
      "requestMappings": [{
        "requestParam": "scope",
        "match": "atrium-wrong-audience",
        "claims": { "sub": "atrium-user", "aud": ["not-atrium"] }
      }]
    },
    {
      "issuerId": "default",
      "tokenExpiry": -60,
      "requestMappings": [{
        "requestParam": "scope",
        "match": "atrium-expired",
        "claims": { "sub": "atrium-user", "aud": ["atrium"] }
      }]
    }
  ]
}"#;

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

fn unused_loopback_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind an ephemeral loopback port");
    listener
        .local_addr()
        .expect("read the ephemeral loopback port")
        .port()
}

async fn wait_for_ok(url: &str) {
    timeout(Duration::from_secs(30), async {
        loop {
            if reqwest::get(url)
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("Atrium must report health within the readiness deadline");
}

async fn issue_token(client: &reqwest::Client, base_url: &str, scope: &str) -> String {
    client
        .post(format!("{base_url}/{ISSUER_ID}/token"))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", "atrium-test"),
            ("scope", scope),
        ])
        .basic_auth("atrium-test", Some("test-secret"))
        .send()
        .await
        .expect("OIDC fixture token request")
        .error_for_status()
        .expect("OIDC fixture must issue an access token")
        .json::<TokenResponse>()
        .await
        .expect("OIDC fixture token response")
        .access_token
}

async fn authenticated_status(base_url: &str, token: &str) -> reqwest::StatusCode {
    reqwest::Client::new()
        .get(format!("{base_url}/v1/workspaces"))
        .bearer_auth(token)
        .send()
        .await
        .expect("request Atrium route")
        .status()
}

/// Atrium accepts a discovery/JWKS-issued token and rejects tokens that differ
/// only in `aud` or `exp`.
#[tokio::test]
async fn oidc_discovery_and_jwks_enforce_token_claims() {
    let oidc = GenericImage::new(MOCK_OIDC_IMAGE, MOCK_OIDC_TAG)
        .with_exposed_port(OIDC_PORT)
        .with_wait_for(WaitFor::Nothing)
        .with_env_var("JSON_CONFIG", MOCK_OIDC_CONFIG)
        .start()
        .await
        .expect("start OIDC fixture container");
    let oidc_port = oidc
        .get_host_port_ipv4(OIDC_PORT)
        .await
        .expect("map OIDC fixture port");
    let oidc_base_url = format!("http://127.0.0.1:{oidc_port}");
    wait_for_ok(&format!("{oidc_base_url}/isalive")).await;
    let discovery_url = format!("{oidc_base_url}/{ISSUER_ID}/.well-known/openid-configuration");

    let atrium_port = unused_loopback_port();
    let atrium_base_url = format!("http://127.0.0.1:{atrium_port}");
    let db_path = std::env::temp_dir().join(format!("atrium-oidc-{}.sqlite", uuid::Uuid::new_v4()));
    let mut atrium = Command::new(env!("CARGO_BIN_EXE_atrium"))
        .args([
            "--host",
            "0.0.0.0",
            "--port",
            &atrium_port.to_string(),
            "--atrium-db",
            db_path.to_str().expect("temporary database path is UTF-8"),
        ])
        .env("ATRIUM_OIDC_ISSUER", format!("{oidc_base_url}/{ISSUER_ID}"))
        .env("ATRIUM_OIDC_DISCOVERY_URL", &discovery_url)
        .env("ATRIUM_OIDC_AUDIENCE", AUDIENCE)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start Atrium OIDC server");

    let result = async {
        wait_for_ok(&format!("{atrium_base_url}/v1/health")).await;
        let client = reqwest::Client::new();
        let valid = issue_token(&client, &oidc_base_url, "atrium-valid").await;
        let wrong_audience = issue_token(&client, &oidc_base_url, "atrium-wrong-audience").await;
        let expired = issue_token(&client, &oidc_base_url, "atrium-expired").await;

        assert!(
            authenticated_status(&atrium_base_url, &valid)
                .await
                .is_success(),
            "a discovery/JWKS-issued token with the configured audience must authenticate"
        );
        assert_eq!(
            authenticated_status(&atrium_base_url, &wrong_audience).await,
            reqwest::StatusCode::UNAUTHORIZED,
            "a correctly signed token with a different audience must be rejected"
        );
        assert_eq!(
            authenticated_status(&atrium_base_url, &expired).await,
            reqwest::StatusCode::UNAUTHORIZED,
            "a correctly signed expired token must be rejected"
        );
    }
    .await;

    atrium.kill().await.expect("stop Atrium process");
    let _ = tokio::fs::remove_file(&db_path).await;
    let _ = tokio::fs::remove_file(PathBuf::from(format!("{}-wal", db_path.display()))).await;
    let _ = tokio::fs::remove_file(PathBuf::from(format!("{}-shm", db_path.display()))).await;
    let _ = result;
}
