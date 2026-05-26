/**
 * E2E tests for the OpenAPI spec endpoint and Swagger UI.
 */

import { describe, expect, it } from "vitest";
import { PalladiumClient } from "../client.js";

const client = new PalladiumClient();

describe("GET /api-doc/openapi.json", () => {
  it("returns 200 with JSON", async () => {
    const spec = await client.getOpenApiSpec();
    expect(typeof spec).toBe("object");
  });

  it("spec has openapi version field", async () => {
    const spec = await client.getOpenApiSpec();
    expect(typeof spec.openapi).toBe("string");
    expect(spec.openapi).toMatch(/^3\./);
  });

  it("spec includes /v1/changes paths", async () => {
    const spec = await client.getOpenApiSpec();
    expect(spec.paths["/v1/changes"]).toBeDefined();
  });

  it("spec has info title and version", async () => {
    const spec = await client.getOpenApiSpec();
    expect(typeof spec.info.title).toBe("string");
    expect(typeof spec.info.version).toBe("string");
  });

  it("spec defines Change and Hlc schemas", async () => {
    const spec = await client.getOpenApiSpec();
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noPropertyAccessFromIndexSignature
    expect(spec.components?.schemas?.["Change"]).toBeDefined();
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noPropertyAccessFromIndexSignature
    expect(spec.components?.schemas?.["Hlc"]).toBeDefined();
  });
});

describe("GET /swagger-ui/ (Swagger UI)", () => {
  it("returns 200 with HTML content", async () => {
    const res = await client.getSwaggerUi();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("swagger");
  });
});
