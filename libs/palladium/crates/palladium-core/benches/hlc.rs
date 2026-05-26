//! Micro-benchmarks for [`Hlc`] `send` and `recv` operations.
//!
//! Run with: `cargo bench -p palladium-core --bench hlc`
#![allow(missing_docs, clippy::unwrap_used, clippy::expect_used)]

use criterion::{
    black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput,
};
use palladium_core::{Hlc, NodeId};
use uuid::Uuid;

const fn node(n: u128) -> NodeId {
    NodeId::from_uuid(Uuid::from_u128(n))
}

// ── send ─────────────────────────────────────────────────────────────────

fn bench_send(c: &mut Criterion) {
    let mut g = c.benchmark_group("hlc_send");

    // Wall clock advances each iteration → counter always resets to 0.
    g.bench_function("wall_advancing", |b| {
        let mut h = Hlc::new(node(1), 1_000);
        let mut wall = 1_000_u64;
        b.iter(|| {
            wall += 1;
            h = h.send(black_box(wall));
        });
    });

    // Wall clock frozen → counter monotonically increments.
    g.bench_function("wall_stale", |b| {
        let mut h = Hlc::new(node(1), 1_000);
        b.iter(|| {
            h = h.send(black_box(1_000_u64));
        });
    });

    // Counter already saturated at u32::MAX → saturating_add stays at MAX.
    g.bench_function("counter_saturated", |b| {
        let h = Hlc::from_parts(1_000, u32::MAX, node(1));
        b.iter(|| {
            let _ = black_box(h).send(black_box(1_000_u64));
        });
    });

    // Wall clock behind local clock → local millis win, counter increments.
    g.bench_function("wall_behind_local", |b| {
        let mut h = Hlc::new(node(1), 5_000);
        b.iter(|| {
            h = h.send(black_box(1_000_u64));
        });
    });

    g.finish();
}

// ── recv ─────────────────────────────────────────────────────────────────

fn bench_recv(c: &mut Criterion) {
    let local_node = node(1);
    let remote_node = node(2);
    let mut g = c.benchmark_group("hlc_recv");

    // Remote millis dominate → take remote counter + 1.
    g.bench_function("remote_ahead", |b| {
        let local = Hlc::new(local_node, 1_000);
        let remote = Hlc::new(remote_node, 2_000);
        b.iter(|| {
            let _ = black_box(local).recv(black_box(1_000_u64), black_box(&remote));
        });
    });

    // Local millis dominate → take local counter + 1.
    g.bench_function("local_ahead", |b| {
        let local = Hlc::new(local_node, 2_000);
        let remote = Hlc::new(remote_node, 1_000);
        b.iter(|| {
            let _ = black_box(local).recv(black_box(1_500_u64), black_box(&remote));
        });
    });

    // Wall clock beats both → counter resets to 0.
    g.bench_function("wall_ahead", |b| {
        let local = Hlc::new(local_node, 1_000);
        let remote = Hlc::new(remote_node, 1_000);
        b.iter(|| {
            let _ = black_box(local).recv(black_box(3_000_u64), black_box(&remote));
        });
    });

    // All three equal → max(local.counter, remote.counter) + 1.
    g.bench_function("three_way_tie", |b| {
        let local = Hlc::from_parts(1_000, 5, local_node);
        let remote = Hlc::from_parts(1_000, 9, remote_node);
        b.iter(|| {
            let _ = black_box(local).recv(black_box(1_000_u64), black_box(&remote));
        });
    });

    // Counters both saturated at u32::MAX; saturating_add stays at MAX.
    g.bench_function("both_counters_saturated", |b| {
        let local = Hlc::from_parts(1_000, u32::MAX, local_node);
        let remote = Hlc::from_parts(1_000, u32::MAX, remote_node);
        b.iter(|| {
            let _ = black_box(local).recv(black_box(1_000_u64), black_box(&remote));
        });
    });

    g.finish();
}

// ── throughput scaling ────────────────────────────────────────────────────

/// Measures how `send()` throughput scales with chain length (N sequential sends).
fn bench_send_throughput(c: &mut Criterion) {
    let mut g = c.benchmark_group("hlc_send_chain");
    for &n in &[1_u64, 10, 100, 1_000] {
        g.throughput(Throughput::Elements(n));
        g.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, &n| {
            b.iter(|| {
                let mut h = Hlc::new(node(1), 0);
                for i in 0..n {
                    h = h.send(black_box(i));
                }
                black_box(h)
            });
        });
    }
    g.finish();
}

/// Measures how `recv()` throughput scales with merge-chain length.
fn bench_recv_throughput(c: &mut Criterion) {
    let local_node = node(1);
    let remote_node = node(2);
    let mut g = c.benchmark_group("hlc_recv_chain");
    for &n in &[1_u64, 10, 100, 1_000] {
        g.throughput(Throughput::Elements(n));
        g.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, &n| {
            b.iter(|| {
                let mut local = Hlc::new(local_node, 0);
                let mut remote = Hlc::new(remote_node, 0);
                for i in 0..n {
                    local = local.recv(black_box(i), black_box(&remote));
                    // alternate: remote advances so local must keep up
                    remote = remote.send(black_box(i + 1));
                }
                black_box(local)
            });
        });
    }
    g.finish();
}

criterion_group!(
    benches,
    bench_send,
    bench_recv,
    bench_send_throughput,
    bench_recv_throughput,
);
criterion_main!(benches);
