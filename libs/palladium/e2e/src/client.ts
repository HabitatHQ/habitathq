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
  async getChanges(after?: string): Promise<{
    readonly version: 1;
    readonly changes: ServerChange[];
    readonly cursor: string | null;
    readonly upperBound: string;
    readonly caughtUp: boolean;
    readonly control: { readonly mustRefetch: boolean };
  }> {
    const url = new URL(`${this.base}/v1/changes`);
    if (after !== undefined) url.searchParams.set("cursor", after);
    url.searchParams.set("limit", "100");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GET /v1/changes failed: ${res.status}`);
    return res.json() as Promise<{
      readonly version: 1;
      readonly changes: ServerChange[];
      readonly cursor: string | null;
      readonly upperBound: string;
      readonly caughtUp: boolean;
      readonly control: { readonly mustRefetch: boolean };
    }>;
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
