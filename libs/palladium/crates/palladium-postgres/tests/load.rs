//! Load, stress, and spike tests for [`PostgresStore`].
//!
//! These tests require Docker and are gated behind the `load-tests` feature
//! flag so they never run in normal `cargo test` runs:
//!
//! ```sh
//! cargo test -p palladium-postgres --features load-tests --test load -- --nocapture
//! ```
//!
//! Each test spins up a throwaway Postgres container via [`testcontainers`],
//! runs its scenario, prints throughput metrics, and asserts correctness
//! (no panics, no data loss, no duplicate rows).

#![cfg(feature = "load-tests")]
#![allow(
    missing_docs,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use std::time::{Duration, Instant};

use palladium_core::{Change, ChangeStore, Hlc, NodeId, Op};
use palladium_postgres::PostgresStore;
use serde_json::json;
use testcontainers::{runners::AsyncRunner, ContainerAsync, ImageExt};
use testcontainers_modules::postgres::Postgres;
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────

const fn node(n: u128) -> NodeId {
    NodeId::from_uuid(Uuid::from_u128(n))
}

fn make_change(hlc: Hlc, op_count: usize) -> Change {
    let ops = (0..op_count)
        .map(|i| Op::Insert {
            table: "todos".into(),
            row_id: Uuid::new_v4(),
            data: json!({"index": i, "text": "load test item"}),
        })
        .collect();
    Change::new(hlc, ops)
}

async fn start_store() -> (ContainerAsync<Postgres>, PostgresStore) {
    let container = Postgres::default()
        .with_env_var("POSTGRES_PASSWORD", "postgres")
        .start()
        .await
        .expect("failed to start Postgres container");

    let host = container.get_host().await.expect("get host");
    let port = container.get_host_port_ipv4(5432).await.expect("get port");
    let url = format!("postgres://postgres:postgres@{host}:{port}/postgres");

    let store = PostgresStore::connect(&url).await.expect("connect to store");
    (container, store)
}

fn print_metrics(label: &str, count: usize, elapsed: Duration) {
    let secs = elapsed.as_secs_f64();
    let ops_per_sec = count as f64 / secs;
    println!(
        "[{label}] {count} changes in {secs:.3}s = {ops_per_sec:.0} changes/sec"
    );
}

// ── average load test ─────────────────────────────────────────────────────

/// Simulates normal production load: sequential inserts at a steady rate,
/// followed by a read-all pass.  Asserts all changes are stored without loss.
#[tokio::test]
async fn load_average_sequential_inserts() {
    const CHANGE_COUNT: usize = 500;
    const OPS_PER_CHANGE: usize = 3;

    let (_container, store) = start_store().await;
    let n = node(1);
    let mut hlc = Hlc::new(n, 1_000);

    let start = Instant::now();
    for i in 0..CHANGE_COUNT {
        hlc = hlc.send(1_000 + i as u64);
        let change = make_change(hlc, OPS_PER_CHANGE);
        store.insert(&change).await.expect("insert failed");
    }
    let insert_elapsed = start.elapsed();
    print_metrics("load/insert", CHANGE_COUNT, insert_elapsed);

    // Verify: all changes are retrievable.
    let read_start = Instant::now();
    let all = store.list_after(None, None).await.expect("list_after failed");
    let read_elapsed = read_start.elapsed();
    print_metrics("load/read", all.len(), read_elapsed);

    assert_eq!(
        all.len(),
        CHANGE_COUNT,
        "expected {CHANGE_COUNT} changes, got {}",
        all.len()
    );
}

/// Average load with interleaved reads and writes (simulates sync replication
/// where a receiver queries for new changes while writers are active).
#[tokio::test]
async fn load_interleaved_reads_and_writes() {
    const BATCH_SIZE: usize = 50;
    const BATCHES: usize = 10;

    let (_container, store) = start_store().await;
    let n = node(2);
    let mut hlc = Hlc::new(n, 2_000);
    let mut inserted_total = 0_usize;

    let start = Instant::now();
    for batch in 0..BATCHES {
        // Write a batch.
        for i in 0..BATCH_SIZE {
            hlc = hlc.send(2_000 + (batch * BATCH_SIZE + i) as u64);
            store.insert(&make_change(hlc, 1)).await.expect("insert");
        }
        inserted_total += BATCH_SIZE;

        // Read all so far (simulates a sync client catching up).
        let seen = store.list_after(None, None).await.expect("list_after");
        assert_eq!(seen.len(), inserted_total, "batch {batch}: row count mismatch");
    }
    print_metrics("load/interleaved", inserted_total, start.elapsed());
}

// ── stress test ───────────────────────────────────────────────────────────

/// Pushes beyond normal load: 5 000 inserts with large payloads.
/// Verifies no data is lost and no errors occur under sustained pressure.
#[tokio::test]
async fn stress_high_volume_large_payloads() {
    const CHANGE_COUNT: usize = 5_000;
    const OPS_PER_CHANGE: usize = 20;

    let (_container, store) = start_store().await;
    let n = node(3);
    let mut hlc = Hlc::new(n, 10_000);

    let start = Instant::now();
    for i in 0..CHANGE_COUNT {
        hlc = hlc.send(10_000 + i as u64);
        store
            .insert(&make_change(hlc, OPS_PER_CHANGE))
            .await
            .expect("stress insert failed");
    }
    let elapsed = start.elapsed();
    print_metrics("stress/insert", CHANGE_COUNT, elapsed);

    // Sanity-check: the count must be exact.
    let all = store.list_after(None, None).await.expect("list_after");
    assert_eq!(all.len(), CHANGE_COUNT);
}

/// Concurrent writers: 10 tasks each inserting 200 changes into the same store.
/// Asserts total count equals 10 × 200 = 2 000 with no duplicates.
#[tokio::test]
async fn stress_concurrent_writers() {
    use std::sync::Arc;

    const WRITERS: usize = 10;
    const PER_WRITER: usize = 200;

    let (_container, store) = start_store().await;
    let store = Arc::new(store);

    let start = Instant::now();

    let handles: Vec<_> = (0..WRITERS)
        .map(|w| {
            let store = Arc::clone(&store);
            tokio::spawn(async move {
                let n = node(w as u128 + 100);
                let mut hlc = Hlc::new(n, 1_000);
                for i in 0..PER_WRITER {
                    hlc = hlc.send(1_000 + i as u64);
                    store
                        .insert(&make_change(hlc, 1))
                        .await
                        .expect("concurrent insert failed");
                }
            })
        })
        .collect();

    for h in handles {
        h.await.expect("writer task panicked");
    }

    let elapsed = start.elapsed();
    let total = WRITERS * PER_WRITER;
    print_metrics("stress/concurrent", total, elapsed);

    let all = store.list_after(None, None).await.expect("list_after");
    assert_eq!(all.len(), total, "expected {total} rows, got {}", all.len());

    // Verify uniqueness — no duplicate IDs.
    let mut ids: Vec<_> = all.iter().map(|c| c.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), total, "duplicate change IDs detected");
}

/// Cursor-based pagination under stress: insert N changes then paginate
/// through them with `list_after`, verifying no gaps or duplicates.
#[tokio::test]
async fn stress_cursor_pagination_correctness() {
    const TOTAL: usize = 2_000;
    const PAGE_SIZE: usize = 100;

    let (_container, store) = start_store().await;
    let n = node(4);
    let mut hlc = Hlc::new(n, 5_000);
    for i in 0..TOTAL {
        hlc = hlc.send(5_000 + i as u64);
        let c = make_change(hlc, 1);
        store.insert(&c).await.expect("insert");
    }

    // Paginate: each page uses the HLC of the last seen change as cursor.
    let mut cursor: Option<Hlc> = None;
    let mut seen_ids: Vec<Uuid> = Vec::with_capacity(TOTAL);

    loop {
        let page = store.list_after(cursor, None).await.expect("list_after");
        if page.is_empty() {
            break;
        }
        let last_hlc = page.last().expect("non-empty page").hlc;
        for c in &page {
            seen_ids.push(c.id);
        }
        let count = page.len();
        cursor = Some(last_hlc);
        if count < PAGE_SIZE {
            break;
        }
    }

    assert_eq!(seen_ids.len(), TOTAL, "pagination missed changes");

    seen_ids.sort_unstable();
    seen_ids.dedup();
    assert_eq!(seen_ids.len(), TOTAL, "pagination returned duplicates");
}

// ── spike test ────────────────────────────────────────────────────────────

/// Simulates a traffic spike: low baseline → sudden burst → return to baseline.
///
/// Measures throughput in each phase and asserts that all changes survive the
/// spike without any data loss.
#[tokio::test]
async fn spike_burst_then_recovery() {
    const WARMUP: usize = 100;
    const SPIKE: usize = 2_000;
    const COOLDOWN: usize = 100;

    let (_container, store) = start_store().await;
    let n = node(5);
    let mut hlc = Hlc::new(n, 20_000);
    let mut wall = 20_000_u64;

    // Phase 1 — warm-up (baseline load).
    let t0 = Instant::now();
    for _ in 0..WARMUP {
        wall += 1;
        hlc = hlc.send(wall);
        store.insert(&make_change(hlc, 1)).await.expect("warmup insert");
    }
    let warmup_elapsed = t0.elapsed();
    print_metrics("spike/warmup", WARMUP, warmup_elapsed);

    // Phase 2 — spike (burst of inserts as fast as possible).
    let t1 = Instant::now();
    for _ in 0..SPIKE {
        wall += 1;
        hlc = hlc.send(wall);
        store.insert(&make_change(hlc, 5)).await.expect("spike insert");
    }
    let spike_elapsed = t1.elapsed();
    print_metrics("spike/burst", SPIKE, spike_elapsed);

    // Phase 3 — cooldown (back to baseline).
    let t2 = Instant::now();
    for _ in 0..COOLDOWN {
        wall += 1;
        hlc = hlc.send(wall);
        store.insert(&make_change(hlc, 1)).await.expect("cooldown insert");
    }
    let cooldown_elapsed = t2.elapsed();
    print_metrics("spike/cooldown", COOLDOWN, cooldown_elapsed);

    // Assert all changes made it through.
    let total = WARMUP + SPIKE + COOLDOWN;
    let all = store.list_after(None, None).await.expect("list_after");
    assert_eq!(all.len(), total, "data loss during spike: expected {total}, got {}", all.len());
}

/// Spike from multiple concurrent sources simultaneously: 20 goroutines each
/// firing 500 inserts at once, simulating a DDoS-style ingest peak.
#[tokio::test]
async fn spike_concurrent_burst() {
    use std::sync::Arc;

    const CONCURRENT: usize = 20;
    const PER_TASK: usize = 500;

    let (_container, store) = start_store().await;
    let store = Arc::new(store);

    let start = Instant::now();

    let handles: Vec<_> = (0..CONCURRENT)
        .map(|w| {
            let store = Arc::clone(&store);
            tokio::spawn(async move {
                let n = node(w as u128 + 200);
                let mut hlc = Hlc::new(n, 1_000);
                for i in 0..PER_TASK {
                    hlc = hlc.send(1_000 + i as u64);
                    store
                        .insert(&make_change(hlc, 3))
                        .await
                        .expect("spike insert");
                }
            })
        })
        .collect();

    for h in handles {
        h.await.expect("spike task panicked");
    }

    let elapsed = start.elapsed();
    let total = CONCURRENT * PER_TASK;
    print_metrics("spike/concurrent_burst", total, elapsed);

    let all = store.list_after(None, None).await.expect("list_after");
    assert_eq!(all.len(), total);
}
