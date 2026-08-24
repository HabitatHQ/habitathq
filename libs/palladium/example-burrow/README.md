# Burrow — HabitatHQ POC

A minimal HabitatHQ app driving **Atrium** (identity + tenancy + record ACL) over
Palladium's local-first sync engine. It exercises the three sharing classes from
the ERD §7.1 surface end-to-end, against a **dev bearer identity** (no Clerk yet):

| Section | Root table | Sharing class | Child | Demonstrates |
| ------- | ---------- | ------------- | ----- | ------------ |
| Habits  | `habits`   | private only  | `completions` | the private floor + child cascade |
| Lists   | `lists`    | household     | `list_items`  | household grant incl. children |
| Notes   | `notes`    | per-member    | `note_images` (blob) | per-member grant/revoke + blob ACL (A7) |

## Run it

```sh
pnpm --filter @palladium/example-burrow demo
```

This builds + starts Atrium on `:4000` and the Vite dev server on `:5173`.

Then open **two tabs** to play both sides of a family:

- `http://localhost:5173/?user=alice`
- `http://localhost:5173/?user=bob`

### Try the acceptance flow

1. **alice** → *create family*, then *invite a member…* and copy the token.
2. **bob** → paste the token → *join*.
3. **alice** adds a habit → it never appears for bob (private floor).
4. **alice** adds a list → toggle it to **read** or **read+write** → bob sees the
   list *and* its items (household grant, child inheritance).
5. **alice** adds a note, attaches an image, and **grants** it to bob → bob
   backfills the note and its image; **revoke** → the note disappears for bob
   (grant-backfill / revoke-purge). carol never sees it.

## How it wires to Atrium

The bare `SyncTransport` speaks palladium-axum's protocol; Atrium wraps changes
in a `{ changes, purges }` envelope and derives the tenant scope from an
`X-Workspace` header. `src/atrium.ts` adapts both without forking the transport:

- **`authHeaders`** supplies `Authorization: Bearer <user>` + `X-Workspace: <id>`.
- **`decodeChanges`** unwraps the envelope and applies server-driven purges
  locally (via `applyRemote`, so they are not re-synced).
- Control-plane calls (workspaces, invites, shares, blobs) go through the
  `AtriumApi` REST client.

> **In-memory store.** Each tab uses an in-memory SQLite for now; per-account
> OPFS persistence and real Clerk sign-in are the next increments.
