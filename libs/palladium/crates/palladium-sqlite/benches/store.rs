//! Micro-benchmarks for `palladium-sqlite` pure-computation hot paths.
//!
//! These benchmarks focus on CPU-only work: the HLC sort-key formatter and
//! row-to-`Change` deserialization path (JSON decode + type conversions).
//!
//! Run with: `cargo bench -p palladium-sqlite --bench store`
#![allow(
    missing_docs,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::cast_possible_truncation
)]

use criterion::{
    black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput,
};
use palladium_core::{Hlc, NodeId, Op};
use serde_json::json;
use uuid::Uuid;

const fn node(n: u128) -> NodeId {
    NodeId::from_uuid(Uuid::from_u128(n))
}

// ── Sort-key generation ───────────────────────────────────────────────────
//
// `hlc_sort_key` is private to the store module; we benchmark the equivalent
// format! call directly — the micro-benchmark is measuring `format!` with
// zero-padded integers and hex u128, which is the actual hot path on every
// INSERT and SELECT.

#[inline]
fn hlc_sort_key(hlc: &Hlc) -> String {
    format!(
        "{:020}_{:010}_{:032x}",
        hlc.millis(),
        hlc.counter(),
        hlc.node_id().as_uuid().as_u128()
    )
}

fn bench_sort_key(c: &mut Criterion) {
    let mut g = c.benchmark_group("hlc_sort_key");

    // Typical case: mid-range values.
    g.bench_function("typical", |b| {
        let hlc = Hlc::from_parts(1_700_000_000_000, 42, node(0xDEAD_BEEF));
        b.iter(|| hlc_sort_key(black_box(&hlc)));
    });

    // Zero values — all padding, cheapest formatting case.
    g.bench_function("zero", |b| {
        let hlc = Hlc::from_parts(0, 0, node(0));
        b.iter(|| hlc_sort_key(black_box(&hlc)));
    });

    // Maximum values — most digits, most expensive formatting.
    g.bench_function("max_values", |b| {
        #[allow(clippy::cast_sign_loss)]
        let hlc = Hlc::from_parts(i64::MAX as u64, u32::MAX, node(u128::MAX));
        b.iter(|| hlc_sort_key(black_box(&hlc)));
    });

    // Throughput: how many keys per second at realistic HLC density.
    g.throughput(Throughput::Elements(1));
    g.bench_function("throughput_1key", |b| {
        let hlc = Hlc::from_parts(1_700_000_000_000, 0, node(1));
        b.iter(|| hlc_sort_key(black_box(&hlc)));
    });

    g.finish();
}

/// Measures sort-key generation across a chain of advancing HLC timestamps,
/// simulating the per-INSERT overhead in a write-heavy workload.
fn bench_sort_key_chain(c: &mut Criterion) {
    let mut g = c.benchmark_group("hlc_sort_key_chain");
    let n1 = node(1);

    for &n in &[10_u64, 100, 1_000] {
        g.throughput(Throughput::Elements(n));
        g.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, &n| {
            b.iter(|| {
                let mut h = Hlc::new(n1, 1_700_000_000_000);
                let mut keys = Vec::with_capacity(n as usize);
                for i in 0..n {
                    h = h.send(black_box(1_700_000_000_000 + i));
                    keys.push(hlc_sort_key(&h));
                }
                black_box(keys)
            });
        });
    }

    g.finish();
}

// ── Row deserialization (ops_json → Vec<Op>) ──────────────────────────────
//
// In `list_after`, every row fetched from SQLite must deserialize its
// `ops_json` TEXT column.  This benchmark isolates that JSON-parse path.

fn make_ops_json(count: usize) -> String {
    let ops: Vec<serde_json::Value> = (0..count)
        .map(|i| {
            json!({
                "op": "insert",
                "table": "todos",
                "row_id": Uuid::from_u128(i as u128).to_string(),
                "data": {"text": "item", "index": i}
            })
        })
        .collect();
    serde_json::to_string(&ops).unwrap()
}

fn bench_ops_json_deser(c: &mut Criterion) {
    let mut g = c.benchmark_group("ops_json_deserialize");

    for &count in &[0_usize, 1, 5, 10, 50] {
        let json = make_ops_json(count);
        g.throughput(Throughput::Elements(count.max(1) as u64));
        g.bench_with_input(BenchmarkId::new("ops", count), &json, |b, j| {
            b.iter(|| serde_json::from_str::<Vec<Op>>(black_box(j.as_str())).unwrap());
        });
    }

    g.finish();
}

// ── NodeId parsing (hlc_node_id TEXT column → NodeId) ────────────────────
//
// Every row in `list_after` must parse the `hlc_node_id` TEXT column into a
// `NodeId` via `str::parse`.  This benchmark measures that cost.

fn bench_node_id_parse(c: &mut Criterion) {
    let node_id = node(0xDEAD_CAFE_BABE_1234_5678_9ABC_DEF0_1234);
    let as_str = node_id.to_string();

    let mut g = c.benchmark_group("node_id_parse");

    g.bench_function("from_str", |b| {
        b.iter(|| black_box(as_str.as_str()).parse::<NodeId>().unwrap());
    });

    g.bench_function("to_string", |b| {
        b.iter(|| black_box(node_id).to_string());
    });

    g.finish();
}

criterion_group!(
    benches,
    bench_sort_key,
    bench_sort_key_chain,
    bench_ops_json_deser,
    bench_node_id_parse,
);
criterion_main!(benches);
