import { beforeAll, describe, expect, it, vi } from "vitest";
import { convertBlobBytes } from "../blob-format.js";

beforeAll(() => {
  if (!globalThis.URL.createObjectURL) {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  }
});

describe("convertBlobBytes", () => {
  it("returns null when bytes is null (bytes format)", () => {
    expect(convertBlobBytes(null, "bytes")).toBeNull();
  });

  it("returns null when bytes is null (blob format)", () => {
    expect(convertBlobBytes(null, "blob")).toBeNull();
  });

  it("returns null when bytes is null (url format)", () => {
    expect(convertBlobBytes(null, "url")).toBeNull();
  });

  it("returns null when bytes is null (stream format)", () => {
    expect(convertBlobBytes(null, "stream")).toBeNull();
  });

  it("returns Uint8Array for bytes format", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(convertBlobBytes(bytes, "bytes")).toBe(bytes);
  });

  it("returns Blob for blob format", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = convertBlobBytes(bytes, "blob");
    expect(result).toBeInstanceOf(Blob);
    expect(result?.size).toBe(3);
  });

  it("returns Blob with correct mime type", () => {
    const bytes = new Uint8Array([1]);
    const result = convertBlobBytes(bytes, "blob", "image/png");
    expect(result?.type).toBe("image/png");
  });

  it("returns string URL for url format", () => {
    const bytes = new Uint8Array([1]);
    const result = convertBlobBytes(bytes, "url");
    expect(typeof result).toBe("string");
    expect(result?.startsWith("blob:")).toBe(true);
  });

  it("returns ReadableStream for stream format", () => {
    const bytes = new Uint8Array([1]);
    const result = convertBlobBytes(bytes, "stream");
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it("stream produces the original bytes when read", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const stream = convertBlobBytes(bytes, "stream");
    const reader = stream?.getReader();
    const chunk = await reader?.read();
    expect(chunk?.value).toEqual(bytes);
  });
});
