/**
 * Typed HTTP client for the Palladium sync-engine REST API.
 *
 * Wire-format note: the Rust server and `@palladium/core` agree on Hlc field
 * names (`wallMs`, `counter`, `nodeId`) — Rust uses `#[serde(rename = ...)]`
 * to project its internal snake_case fields to the camelCase wire shape.
 */

import type { Hlc } from "@palladium/core";
import { E2E_BASE_URL } from "./setup/server.js";

// ── Server-side wire types ──────────────────────────────────────────────────

export type ServerOp =
  | {
      readonly op: "insert";
      readonly table: string;
      readonly row_id: string;
      readonly data: Record<string, unknown>;
    }
  | {
      readonly op: "update";
      readonly table: string;
      readonly row_id: string;
      readonly col: string;
      readonly value: unknown;
    }
  | { readonly op: "delete"; readonly table: string; readonly row_id: string };

export interface ServerChange {
  readonly id: string; // UUID
  readonly hlc: Hlc;
  readonly ops: ServerOp[];
}

// ── Conversion helpers ──────────────────────────────────────────────────────

/**
 * Encode an [`Hlc`] as the lexicographic sort-key cursor expected by `?after=`.
 *
 * Format: `{wallMs:020}_{counter:010}_{nodeIdHex:032x}`
 */
export function hlcToAfterCursor(hlc: Hlc): string {
  const nodeHex = hlc.nodeId.replaceAll("-", "").padStart(32, "0");
  const millis = String(hlc.wallMs).padStart(20, "0");
  const counter = String(hlc.counter).padStart(10, "0");
  return `${millis}_${counter}_${nodeHex}`;
}

// ── OpenAPI spec (minimal shape for assertions) ────────────────────────────

export interface OpenApiSpec {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, unknown>;
  readonly components?: {
    readonly schemas?: Record<string, unknown>;
  };
}

// ── Client ──────────────────────────────────────────────────────────────────

export class PalladiumClient {
  private readonly base: string;

  constructor(base = E2E_BASE_URL) {
    this.base = base;
  }

  /** `POST /v1/changes` — submit a change. */
  async postChange(change: ServerChange): Promise<Response> {
    return fetch(`${this.base}/v1/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
  }

  /** `GET /v1/changes` — list all changes (optionally after a cursor). */
  async getChanges(after?: string): Promise<ServerChange[]> {
    const url = new URL(`${this.base}/v1/changes`);
    if (after !== undefined) url.searchParams.set("after", after);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GET /v1/changes failed: ${res.status}`);
    return res.json() as Promise<ServerChange[]>;
  }

  /** `GET /api-doc/openapi.json` — fetch the OpenAPI spec. */
  async getOpenApiSpec(): Promise<OpenApiSpec> {
    const res = await fetch(`${this.base}/api-doc/openapi.json`);
    if (!res.ok) throw new Error(`GET /api-doc/openapi.json failed: ${res.status}`);
    return res.json() as Promise<OpenApiSpec>;
  }

  /** `GET /swagger-ui/` — Swagger UI page. */
  async getSwaggerUi(): Promise<Response> {
    return fetch(`${this.base}/swagger-ui/`);
  }
}
