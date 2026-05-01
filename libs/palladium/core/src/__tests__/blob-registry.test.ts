import { beforeAll, describe, expect, it, vi } from "vitest";
import { BlobRegistry } from "../blob-registry.js";

beforeAll(() => {
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("BlobRegistry", () => {
  it("tracks URLs", () => {
    const r = new BlobRegistry();
    r.track("blob:a");
    r.track("blob:b");
    expect(r.size).toBe(2);
  });

  it("track returns the same URL for chaining", () => {
    const r = new BlobRegistry();
    const url = r.track("blob:x");
    expect(url).toBe("blob:x");
  });

  it("revoke removes one URL and reduces size", () => {
    const r = new BlobRegistry();
    r.track("blob:a");
    r.track("blob:b");
    r.revoke("blob:a");
    expect(r.size).toBe(1);
  });

  it("revoke calls URL.revokeObjectURL", () => {
    const r = new BlobRegistry();
    r.track("blob:rev");
    r.revoke("blob:rev");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rev");
  });

  it("revokeAll clears all URLs", () => {
    const r = new BlobRegistry();
    r.track("blob:a");
    r.track("blob:b");
    r.revokeAll();
    expect(r.size).toBe(0);
  });

  it("revokeAll calls URL.revokeObjectURL for each URL", () => {
    const mockRevoke = vi.spyOn(URL, "revokeObjectURL");
    const r = new BlobRegistry();
    r.track("blob:c1");
    r.track("blob:c2");
    r.revokeAll();
    expect(mockRevoke).toHaveBeenCalledWith("blob:c1");
    expect(mockRevoke).toHaveBeenCalledWith("blob:c2");
  });

  it("size starts at 0", () => {
    const r = new BlobRegistry();
    expect(r.size).toBe(0);
  });

  it("tracking the same URL twice does not duplicate", () => {
    const r = new BlobRegistry();
    r.track("blob:dup");
    r.track("blob:dup");
    expect(r.size).toBe(1);
  });
});
