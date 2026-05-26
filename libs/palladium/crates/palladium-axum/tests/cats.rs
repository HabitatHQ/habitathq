//! Contract and fuzz tests using [CATS] (Contract Automation Testing Suite).
//!
//! CATS runs inside a Docker container (via testcontainers) and fires requests
//! at a live Palladium server that is started in-process for each test.
//!
//! # Running
//!
//! ```sh
//! cargo test -p palladium-axum --features cats-tests --test cats -- --nocapture
//! ```
//!
//! Requires Docker to be running.
//!
//! [CATS]: https://github.com/Endava/cats

#![cfg(feature = "cats-tests")]
#![allow(
    missing_docs,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]

use palladium_axum::{create_router, AppState};
use palladium_sqlite::SqliteStore;
use tower_http::cors::CorsLayer;
use testcontainers::{
    GenericImage, ImageExt,
    core::{Host, WaitFor, wait::ExitWaitStrategy},
    runners::AsyncRunner,
};
use tokio::io::AsyncBufReadExt;
use tokio::net::TcpListener;

/// CATS Docker image.  The `ghcr.io/endava/cats` image is the official release.
const CATS_IMAGE: &str = "ghcr.io/endava/cats";
const CATS_TAG: &str = "latest";

/// Fuzzers that require security headers, HTTPS, or auth flows not present in
/// a minimal local server — skip them to keep the run clean.
const SKIP_FUZZERS: &str =
    "CheckSecurityHeadersFuzzer,HappyFlowsFuzzer,Http2Fuzzer,\
     SecurityHeadersFuzzer";

/// Start an in-process Axum server backed by an in-memory `SQLite` store.
/// Returns the port it is listening on.
async fn start_server() -> u16 {
    let store = SqliteStore::in_memory().await.unwrap();
    let app = create_router(AppState::new(store), CorsLayer::permissive());
    // Bind to all interfaces so the Docker container can reach us via
    // host.docker.internal.
    let listener = TcpListener::bind("0.0.0.0:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    port
}

/// Print every line from a log stream to stdout, prefixed with `[cats]`.
async fn stream_logs(reader: impl tokio::io::AsyncBufRead + Unpin) {
    let mut lines = tokio::io::BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        println!("[cats] {line}");
    }
}

/// Run CATS against a live Palladium server and assert zero violations.
///
/// CATS fires request mutations derived from the `OpenAPI` spec and expects all
/// responses to conform to the spec's declared schemas and status codes.
#[tokio::test]
async fn cats_finds_no_contract_violations() {
    let port = start_server().await;
    let base = format!("http://host.docker.internal:{port}");

    println!("Starting CATS container against {base}");

    // with_wait_for must be called on GenericImage before ImageExt methods
    // (with_host, with_cmd) convert it into a ContainerRequest.
    let container = GenericImage::new(CATS_IMAGE, CATS_TAG)
        // Wait for the container to exit, then assert exit code 0.
        .with_wait_for(WaitFor::exit(
            ExitWaitStrategy::new().with_exit_code(0),
        ))
        // Map `host.docker.internal` → host gateway so the container can
        // reach our in-process server on macOS and Linux.
        .with_host("host.docker.internal", Host::HostGateway)
        // CATS CLI arguments.
        .with_cmd([
            format!("--contract={base}/api-doc/openapi.json"),
            format!("--server={base}"),
            format!("--skipFuzzers={SKIP_FUZZERS}"),
            "--log=WARN".to_string(), // suppress INFO noise; failures stay visible
        ])
        .start()
        .await
        .expect("CATS container should exit with code 0 (no violations)");

    // Stream logs to test output for CI visibility.
    stream_logs(container.stdout(false)).await;
    stream_logs(container.stderr(false)).await;
}
