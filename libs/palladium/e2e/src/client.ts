import type { Hlc } from "@palladium/core";
import { E2E_BASE_URL } from "./setup/server.js";
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
  readonly id: string;
  readonly hlc: Hlc;
  readonly ops: ServerOp[];
}
export function hlcToAfterCursor(hlc: Hlc): string {
  return `${String(hlc.wallMs).padStart(20, "0")}_${String(hlc.counter).padStart(10, "0")}_${hlc.nodeId.replaceAll("-", "").padStart(32, "0")}`;
}
export interface OpenApiSpec {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, unknown>;
  readonly components?: { readonly schemas?: Record<string, unknown> };
}
export class PalladiumClient {
  private readonly base: string;
  constructor(base = E2E_BASE_URL) {
    this.base = base;
  }
  async postChange(change: ServerChange): Promise<Response> {
    return fetch(`${this.base}/v1/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
  }
  async getChanges(after?: string): Promise<ServerChange[]> {
    const url = new URL(`${this.base}/v1/changes`);
    if (after !== undefined) url.searchParams.set("after", after);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GET /v1/changes failed: ${res.status}`);
    return res.json() as Promise<ServerChange[]>;
  }
  async getOpenApiSpec(): Promise<OpenApiSpec> {
    const res = await fetch(`${this.base}/api-doc/openapi.json`);
    if (!res.ok) throw new Error(`GET /api-doc/openapi.json failed: ${res.status}`);
    return res.json() as Promise<OpenApiSpec>;
  }
  async getSwaggerUi(): Promise<Response> {
    return fetch(`${this.base}/swagger-ui/`);
  }
}
