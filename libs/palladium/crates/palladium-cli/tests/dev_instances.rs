//! Consumer coverage for the real `palladium dev` binary and SQLite stores.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Result<Self> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let sequence = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "palladium-cli-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }

    fn database(&self, name: &str) -> String {
        format!("sqlite:{}", self.0.join(name).display())
    }

    fn instance(&self, name: &str, file: &str) -> String {
        format!("{name}:{}", self.database(file))
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct DevServer {
    child: Child,
    address: SocketAddr,
    log: PathBuf,
}

impl DevServer {
    fn spawn(directory: &TestDirectory, db: &str, args: &[&str]) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        drop(listener);
        let log = directory.0.join("server.log");
        let output = File::create(&log)?;
        let child = Command::new(env!("CARGO_BIN_EXE_palladium"))
            .current_dir(&directory.0)
            .env_remove("PALLADIUM_DB")
            .env("NO_COLOR", "1")
            .args(["--db", db, "dev", "--port", &address.port().to_string()])
            .args(args)
            .stdout(Stdio::from(output.try_clone()?))
            .stderr(Stdio::from(output))
            .spawn()?;
        Ok(Self {
            child,
            address,
            log,
        })
    }

    fn diagnostics(&self) -> String {
        fs::read_to_string(&self.log).unwrap_or_default()
    }

    fn wait_ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + TIMEOUT;
        loop {
            if let Some(status) = self.child.try_wait()? {
                bail!(
                    "dev exited before serving ({status}): {}",
                    self.diagnostics()
                );
            }
            if TcpStream::connect_timeout(&self.address, Duration::from_millis(100)).is_ok() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                bail!("dev did not start: {}", self.diagnostics());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn expect_startup_failure(&mut self) -> Result<()> {
        let deadline = Instant::now() + TIMEOUT;
        loop {
            if let Some(status) = self.child.try_wait()? {
                let diagnostics = self.diagnostics();
                assert!(
                    !status.success(),
                    "unexpected successful exit: {diagnostics}"
                );
                assert!(!diagnostics.contains("panicked"), "{diagnostics}");
                return Ok(());
            }
            assert!(
                TcpStream::connect_timeout(&self.address, Duration::from_millis(100)).is_err(),
                "invalid configuration started serving: {}",
                self.diagnostics()
            );
            if Instant::now() >= deadline {
                bail!("invalid configuration did not exit: {}", self.diagnostics());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        authorization: Option<&str>,
        body: Option<&Value>,
    ) -> Result<(u16, Vec<u8>)> {
        let mut stream = TcpStream::connect_timeout(&self.address, TIMEOUT)?;
        stream.set_read_timeout(Some(TIMEOUT))?;
        stream.set_write_timeout(Some(TIMEOUT))?;
        let body = body.map(Value::to_string).unwrap_or_default();
        write!(
            stream,
            "{method} {path} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
            self.address,
            body.len()
        )?;
        if let Some(authorization) = authorization {
            write!(stream, "Authorization: {authorization}\r\n")?;
        }
        write!(stream, "\r\n{body}")?;
        let mut response = Vec::new();
        stream.read_to_end(&mut response)?;
        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .context("HTTP response missing header terminator")?;
        let headers = std::str::from_utf8(&response[..header_end])?;
        let status = headers
            .split_whitespace()
            .nth(1)
            .context("HTTP response missing status")?
            .parse()?;
        Ok((status, response[header_end + 4..].to_vec()))
    }

    fn changes(&self, path: &str, authorization: Option<&str>) -> Result<Value> {
        let (status, body) = self.request("GET", path, authorization, None)?;
        assert_eq!(status, 200, "{}", String::from_utf8_lossy(&body));
        let page: Value = serde_json::from_slice(&body)?;
        Ok(page["changes"].clone())
    }

    fn insert(&self, path: &str, authorization: Option<&str>, change: &Value) -> Result<()> {
        let (status, body) = self.request("POST", path, authorization, Some(change))?;
        assert_eq!(status, 201, "{}", String::from_utf8_lossy(&body));
        Ok(())
    }
}

impl Drop for DevServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn change(id: &str, value: &str) -> Result<Value> {
    let millis = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    let row = "01900000-0000-7000-8000-000000000001";
    Ok(json!({
        "id": id,
        "hlc": {
            "wallMs": millis,
            "counter": 0,
            "nodeId": "00000000-0000-4000-8000-000000000001"
        },
        "ops": [{"op": "insert", "table": "todos", "row_id": row,
                 "data": {"id": row, "title": value}}]
    }))
}

#[test]
fn named_instances_select_independent_stores_and_ignore_default_db() -> Result<()> {
    let directory = TestDirectory::new()?;
    // This parent does not exist: opening --db would make startup fail.
    let ignored_db = directory.database("missing/default.db");
    let alpha = directory.instance("alpha_1", "alpha.db");
    let beta = directory.instance("beta-2", "beta.db");
    let mut server = DevServer::spawn(
        &directory,
        &ignored_db,
        &["--instance", &alpha, "--instance", &beta],
    )?;
    server.wait_ready()?;
    let first = change("00000000-0000-4000-8000-000000000011", "alpha")?;
    let second = change("00000000-0000-4000-8000-000000000012", "beta")?;
    let alpha_path = "/instances/alpha_1/v1/changes";
    let beta_path = "/instances/beta-2/v1/changes";
    server.insert(alpha_path, None, &first)?;
    assert_eq!(server.changes(beta_path, None)?, json!([]));
    server.insert(beta_path, None, &second)?;
    assert_eq!(server.changes(alpha_path, None)?, json!([first]));
    assert_eq!(server.changes(beta_path, None)?, json!([second]));
    assert_eq!(
        server
            .request("GET", "/instances/unknown/v1/changes", None, None)?
            .0,
        404
    );
    assert_eq!(server.request("GET", "/v1/changes", None, None)?.0, 404);
    assert!(directory.0.join("alpha.db").is_file());
    assert!(directory.0.join("beta.db").is_file());
    assert!(!directory.0.join("missing").exists());
    assert!(!directory.0.join("palladium.db").exists());
    Ok(())
}

#[test]
fn bearer_auth_and_scope_isolation_apply_to_every_named_instance() -> Result<()> {
    let directory = TestDirectory::new()?;
    let alpha = directory.instance("alpha", "alpha.db");
    let beta = directory.instance("beta", "beta.db");
    let mut server = DevServer::spawn(
        &directory,
        &directory.database("unused.db"),
        &[
            "--auth",
            "bearer",
            "--instance",
            &alpha,
            "--instance",
            &beta,
        ],
    )?;
    server.wait_ready()?;
    let first = change("00000000-0000-4000-8000-000000000021", "alpha")?;
    let second = change("00000000-0000-4000-8000-000000000022", "beta")?;
    for (path, value) in [
        ("/instances/alpha/v1/changes", &first),
        ("/instances/beta/v1/changes", &second),
    ] {
        for authorization in [None, Some("Basic invalid"), Some("Bearer ")] {
            assert_eq!(server.request("GET", path, authorization, None)?.0, 401);
            assert_eq!(
                server.request("POST", path, authorization, Some(value))?.0,
                401
            );
        }
        server.insert(path, Some("Bearer alice"), value)?;
        assert_eq!(server.changes(path, Some("Bearer bob"))?, json!([]));
        assert_eq!(server.changes(path, Some("Bearer alice"))?, json!([value]));
    }
    assert_eq!(
        server.changes("/instances/alpha/v1/changes", Some("Bearer alice"))?,
        json!([first])
    );
    assert!(!directory.0.join("unused.db").exists());
    Ok(())
}

#[test]
fn no_instances_preserves_root_api_and_auth_modes() -> Result<()> {
    for auth in ["static", "bearer"] {
        let directory = TestDirectory::new()?;
        let mut server = DevServer::spawn(
            &directory,
            &directory.database("root.db"),
            &["--auth", auth],
        )?;
        server.wait_ready()?;
        let authorization = if auth == "bearer" {
            assert_eq!(server.request("GET", "/v1/changes", None, None)?.0, 401);
            Some("Bearer alice")
        } else {
            None
        };
        let value = change("00000000-0000-4000-8000-000000000031", auth)?;
        server.insert("/v1/changes", authorization, &value)?;
        assert_eq!(
            server.changes("/v1/changes", authorization)?,
            json!([value])
        );
        assert_eq!(
            server
                .request("GET", "/instances/root/v1/changes", authorization, None)?
                .0,
            404
        );
        assert!(directory.0.join("root.db").is_file());
    }
    Ok(())
}

#[test]
fn duplicate_instance_names_fail_before_opening_any_store() -> Result<()> {
    let directory = TestDirectory::new()?;
    let first = directory.instance("same", "first.db");
    let second = directory.instance("same", "second.db");
    let mut server = DevServer::spawn(
        &directory,
        &directory.database("default.db"),
        &["--instance", &first, "--instance", &second],
    )?;
    server.expect_startup_failure()?;
    assert!(!directory.0.join("first.db").exists());
    assert!(!directory.0.join("second.db").exists());
    assert!(!directory.0.join("default.db").exists());
    Ok(())
}

#[test]
fn unsafe_instance_names_fail_before_opening_any_store() -> Result<()> {
    for name in ["", "a/b", "{id}", ":id", "*rest", "a.b", "two words", "é"] {
        let directory = TestDirectory::new()?;
        let good = directory.instance("good", "good.db");
        let bad = directory.instance(name, "bad.db");
        let mut server = DevServer::spawn(
            &directory,
            &directory.database("default.db"),
            &["--instance", &good, "--instance", &bad],
        )?;
        server.expect_startup_failure()?;
        assert!(!directory.0.join("good.db").exists(), "name: {name:?}");
        assert!(!directory.0.join("bad.db").exists(), "name: {name:?}");
        assert!(!directory.0.join("default.db").exists(), "name: {name:?}");
    }
    Ok(())
}

#[test]
fn any_instance_open_failure_prevents_serving_a_subset() -> Result<()> {
    let directory = TestDirectory::new()?;
    let good = directory.instance("good", "good.db");
    let bad = directory.instance("bad", "missing/bad.db");
    let mut server = DevServer::spawn(
        &directory,
        &directory.database("default.db"),
        &["--instance", &good, "--instance", &bad],
    )?;
    server.expect_startup_failure()?;
    assert!(!directory.0.join("default.db").exists());
    assert!(!directory.0.join("missing").exists());
    Ok(())
}
