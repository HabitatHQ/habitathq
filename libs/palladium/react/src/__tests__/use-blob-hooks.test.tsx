import { createEngine, MemoryBlobAdapter } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { cleanup, render, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PalladiumProvider } from "../provider.js";
import { useBlob } from "../use-blob.js";
import { useBlobUrl } from "../use-blob-url.js";

beforeAll(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation((_blob) => "blob:mock-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(cleanup);

function makeEngine() {
  const blobAdapter = new MemoryBlobAdapter();
  return createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), [], blobAdapter);
}

function wrapper(
  engine: ReturnType<typeof makeEngine>,
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <PalladiumProvider engine={engine}>{children}</PalladiumProvider>;
  };
}

describe("useBlobUrl", () => {
  it("returns null when id is null", async () => {
    const engine = makeEngine();
    await engine.init();

    let capturedUrl: string | null | undefined;

    function App(): ReactNode {
      const url = useBlobUrl(engine, null);
      capturedUrl = url;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => expect(capturedUrl).toBeDefined());
    expect(capturedUrl).toBeNull();
  });

  it("returns null while blob is loading", async () => {
    const engine = makeEngine();
    await engine.init();

    let capturedUrl: string | null | undefined;

    function App(): ReactNode {
      const url = useBlobUrl(engine, "nonexistent");
      capturedUrl = url;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    // Initially null
    expect(capturedUrl).toBeNull();
  });

  it("returns null for missing blob", async () => {
    const engine = makeEngine();
    await engine.init();

    let capturedUrl: string | null | undefined;

    function App(): ReactNode {
      const url = useBlobUrl(engine, "missing");
      capturedUrl = url;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => expect(capturedUrl).toBeDefined());
    // Missing blob → url is null
    expect(capturedUrl).toBeNull();
  });

  it("returns url after blob is stored", async () => {
    const engine = makeEngine();
    await engine.init();
    await engine.blobs.put("img1", new Uint8Array([1, 2, 3]));

    let capturedUrl: string | null | undefined;

    function App(): ReactNode {
      const url = useBlobUrl(engine, "img1");
      capturedUrl = url;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => capturedUrl !== null);
    expect(typeof capturedUrl).toBe("string");
    expect(capturedUrl?.startsWith("blob:")).toBe(true);
  });
});

describe("useBlob", () => {
  it("returns null when id is null", async () => {
    const engine = makeEngine();
    await engine.init();

    let capturedBytes: Uint8Array | null | undefined;

    function App(): ReactNode {
      const bytes = useBlob(engine, null);
      capturedBytes = bytes;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => capturedBytes !== undefined);
    expect(capturedBytes).toBeNull();
  });

  it("returns null for missing blob", async () => {
    const engine = makeEngine();
    await engine.init();

    let capturedBytes: Uint8Array | null | undefined;

    function App(): ReactNode {
      const bytes = useBlob(engine, "missing");
      capturedBytes = bytes;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => capturedBytes !== undefined);
    expect(capturedBytes).toBeNull();
  });

  it("returns bytes after blob is stored", async () => {
    const engine = makeEngine();
    await engine.init();
    const data = new Uint8Array([10, 20, 30]);
    await engine.blobs.put("file1", data);

    let capturedBytes: Uint8Array | null | undefined;

    function App(): ReactNode {
      const bytes = useBlob(engine, "file1");
      capturedBytes = bytes;
      return <div />;
    }

    render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => capturedBytes !== null && capturedBytes !== undefined);
    expect(capturedBytes).toEqual(data);
  });

  it("updates when id changes", async () => {
    const engine = makeEngine();
    await engine.init();
    await engine.blobs.put("a", new Uint8Array([1]));
    await engine.blobs.put("b", new Uint8Array([2]));

    let currentId = "a";
    let capturedBytes: Uint8Array | null | undefined;

    function App(): ReactNode {
      const bytes = useBlob(engine, currentId);
      capturedBytes = bytes;
      return <div />;
    }

    const { rerender } = render(<App />, { wrapper: wrapper(engine) });
    await waitFor(() => capturedBytes !== null && capturedBytes !== undefined);
    expect(capturedBytes).toEqual(new Uint8Array([1]));

    currentId = "b";
    act(() => {
      rerender(<App />);
    });

    await waitFor(() => capturedBytes?.[0] === 2);
    expect(capturedBytes).toEqual(new Uint8Array([2]));
  });
});
