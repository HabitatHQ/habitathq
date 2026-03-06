1. Frontend Strategy: The "Universal Resilient Client"
The frontend acts as a thick, data-oriented client that prioritizes local latency over network confirmation.

Storage & Performance
The VFS Waterfall: Implement a three-tier storage boot sequence.

Tier 1 (Standard OPFS): Peak performance using SharedArrayBuffer (requires COOP/COEP headers).

Tier 2 (SAHPool): Near-native performance using pre-allocated handles (no headers required, runs on GitHub Pages).

Tier 3 (IndexedDB Fallback): Universal fallback using wa-sqlite's kvvfs for Safari Incognito or restrictive environments.

Automatic VFS Migration: On boot, if a better VFS becomes available (e.g., user moves out of Incognito), the library serializes the SQLite database into a Uint8Array in RAM and hydrates the new VFS.

Managed CRDTs: The library manages Y.Doc instances internally. It stores incremental update buffers in a dedicated _sync_crdt_updates table and performs background compaction into a _sync_crdt_snapshots table to keep I/O light.

Reactivity & DX
CQRS Mutation API: Ditch the heavy ORM. The app dispatches plain JSON "Commands" (e.g., mutate({ table: 'habits', action: 'update', payload: { status: true } })).

Reactive Read Layer: The UI subscribes to table-level change events. When a local mutation or server delta occurs, the UI re-runs its local SQL/Kysely queries to refresh.

Sync Observability: Provide hooks for syncStatus, pendingCount, and isOnline so the user always trusts the "offline-first" nature of the app.

2. Backend Strategy: The "Dual-Head Sequencer"
The backend's primary job is to act as a central traffic controller, assigning a global order to every change in the system.

The Unified Action Log
The Delta Table: Every mutation (from any source) creates a row in a deltas table. This table generates a monotonic sync_id (BigInt).

Stateless Processing: The backend persists the change to the primary Postgres/MySQL record and simultaneously logs the delta.

The Dual-Head Entry Points
Sync Head (/sync/push): Accepts batches of transactions from the sync engine. It rebases these against the master state and broadcasts the resulting deltas.

REST Head (/api/v1/...): Standard REST endpoints for third-party integrations. These must also trigger the Sequencer to generate deltas so that local-first clients receive "Master" updates in real-time.

Streaming & Downlink
Pub/Sub Broadcasting: Use Postgres LISTEN/NOTIFY or Redis to detect new rows in the deltas table.

Protocol Agnostic Adapters: Serve these deltas over a persistent pipe. Support SSE (recommended for PWAs/mobile) or WebSockets (for ultra-low latency text collaboration), with an HTTP Polling fallback for strict firewalls.

Access Control: Every delta broadcast must be filtered by the user’s workspace_id or sync_group before being pushed down the pipe.
