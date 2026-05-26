//! Micro-benchmarks for [`Change`] and [`Op`] serialization / deserialization.
//!
//! Run with: `cargo bench -p palladium-core --bench serde`
#![allow(
    missing_docs,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::cast_possible_truncation
)]

use criterion::{
    black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput,
};
use palladium_core::{Change, Hlc, NodeId, Op};
use serde_json::json;
use uuid::Uuid;

const fn node(n: u128) -> NodeId {
    NodeId::from_uuid(Uuid::from_u128(n))
}

const fn base_hlc() -> Hlc {
    Hlc::new(node(1), 1_000_000)
}

fn insert_op(i: usize) -> Op {
    Op::Insert {
        table: "todos".into(),
        row_id: Uuid::from_u128(i as u128),
        data: json!({"text": "benchmark item", "index": i, "done": false}),
    }
}

fn update_op(i: usize) -> Op {
    Op::Update {
        table: "todos".into(),
        row_id: Uuid::from_u128(i as u128),
        col: "done".into(),
        value: json!(true),
    }
}

fn delete_op(i: usize) -> Op {
    Op::Delete {
        table: "todos".into(),
        row_id: Uuid::from_u128(i as u128),
    }
}

fn make_ops(count: usize) -> Vec<Op> {
    (0..count).map(insert_op).collect()
}

// ── Op serialization ──────────────────────────────────────────────────────

fn bench_op_serialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("op_serialize");

    let insert = insert_op(0);
    let update = update_op(0);
    let delete = delete_op(0);

    g.bench_function("insert", |b| {
        b.iter(|| serde_json::to_string(black_box(&insert)).unwrap());
    });
    g.bench_function("update", |b| {
        b.iter(|| serde_json::to_string(black_box(&update)).unwrap());
    });
    g.bench_function("delete", |b| {
        b.iter(|| serde_json::to_string(black_box(&delete)).unwrap());
    });

    g.finish();
}

// ── Op deserialization ────────────────────────────────────────────────────

fn bench_op_deserialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("op_deserialize");

    // Pre-serialized JSON strings for each variant.
    let insert_json = serde_json::to_string(&insert_op(0)).unwrap();
    let update_json = serde_json::to_string(&update_op(0)).unwrap();
    let delete_json = serde_json::to_string(&delete_op(0)).unwrap();

    g.bench_function("insert", |b| {
        b.iter(|| serde_json::from_str::<Op>(black_box(insert_json.as_str())).unwrap());
    });
    g.bench_function("update", |b| {
        b.iter(|| serde_json::from_str::<Op>(black_box(update_json.as_str())).unwrap());
    });
    g.bench_function("delete", |b| {
        b.iter(|| serde_json::from_str::<Op>(black_box(delete_json.as_str())).unwrap());
    });

    g.finish();
}

// ── Op enum accessors ─────────────────────────────────────────────────────

/// Measures the cost of the exhaustive `match` inside `Op::table()` and
/// `Op::row_id()` — expected to be near-zero after inlining.
fn bench_op_accessors(c: &mut Criterion) {
    let mut g = c.benchmark_group("op_accessors");

    let ops = [insert_op(0), update_op(1), delete_op(2)];
    g.bench_function("table_match", |b| {
        b.iter(|| {
            for op in &ops {
                let _ = black_box(op).table();
            }
        });
    });
    g.bench_function("row_id_match", |b| {
        b.iter(|| {
            for op in &ops {
                let _ = black_box(op).row_id();
            }
        });
    });

    g.finish();
}

// ── Change serialization ──────────────────────────────────────────────────

fn bench_change_serialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("change_serialize");
    let hlc = base_hlc();

    for &op_count in &[0_usize, 1, 5, 10, 50] {
        let change = Change::new(hlc, make_ops(op_count));
        g.throughput(Throughput::Elements(op_count.max(1) as u64));
        g.bench_with_input(
            BenchmarkId::new("ops", op_count),
            &change,
            |b, ch| b.iter(|| serde_json::to_string(black_box(ch)).unwrap()),
        );
    }

    g.finish();
}

// ── Change deserialization ────────────────────────────────────────────────

fn bench_change_deserialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("change_deserialize");
    let hlc = base_hlc();

    for &op_count in &[0_usize, 1, 5, 10, 50] {
        let json = serde_json::to_string(&Change::new(hlc, make_ops(op_count))).unwrap();
        g.throughput(Throughput::Elements(op_count.max(1) as u64));
        g.bench_with_input(
            BenchmarkId::new("ops", op_count),
            &json,
            |b, j| b.iter(|| serde_json::from_str::<Change>(black_box(j.as_str())).unwrap()),
        );
    }

    g.finish();
}

// ── Mixed op-type batches ─────────────────────────────────────────────────

/// Serializes a batch containing all three op variants (realistic workload).
fn bench_mixed_ops_serialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("change_mixed_ops_serialize");
    let hlc = base_hlc();

    for &n in &[3_usize, 9, 30] {
        let ops: Vec<Op> = (0..n)
            .map(|i| match i % 3 {
                0 => insert_op(i),
                1 => update_op(i),
                _ => delete_op(i),
            })
            .collect();
        let change = Change::new(hlc, ops);
        g.throughput(Throughput::Elements(n as u64));
        g.bench_with_input(
            BenchmarkId::new("ops", n),
            &change,
            |b, ch| b.iter(|| serde_json::to_string(black_box(ch)).unwrap()),
        );
    }

    g.finish();
}

// ── Change::new (UUID generation) ─────────────────────────────────────────

/// Isolates the cost of `Uuid::new_v4()` inside `Change::new`.
fn bench_change_new(c: &mut Criterion) {
    let hlc = base_hlc();
    c.bench_function("change_new_uuid_gen", |b| {
        b.iter(|| Change::new(black_box(hlc), vec![]));
    });
}

criterion_group!(
    benches,
    bench_op_serialize,
    bench_op_deserialize,
    bench_op_accessors,
    bench_change_serialize,
    bench_change_deserialize,
    bench_mixed_ops_serialize,
    bench_change_new,
);
criterion_main!(benches);
