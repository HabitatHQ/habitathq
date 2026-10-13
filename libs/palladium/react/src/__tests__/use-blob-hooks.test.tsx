import type { BlobAdapterOptions } from "@palladium/core";
import { createEngine, MemoryBlobAdapter } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, Suspense, startTransition, useState } from "react";
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
  return createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), blobAdapter);
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

function deferred() {
  let resolve = () => {};
  let reject = (_reason: unknown) => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ControlledBlobAdapter extends MemoryBlobAdapter {
  readonly pending = new Map<string, Promise<void>>();

  override async get(id: string, options?: BlobAdapterOptions): Promise<Uint8Array | null> {
    const bytes = await super.get(id, options);
    // A backend may finish an in-flight read despite cancellation.
    await this.pending.get(id);
    return bytes;
  }
}

function renderBlobs(engine: ReturnType<typeof makeEngine>, id: string | null) {
  const renders: { bytes: Uint8Array | null; url: string | null }[] = [];
  const hook = renderHook(
    ({ engine, id }) => {
      const value = { bytes: useBlob(engine, id), url: useBlobUrl(engine, id) };
      renders.push(value);
      return value;
    },
    { initialProps: { engine, id } },
  );
  return { ...hook, renders };
}

describe("blob hook request identity", () => {
  it("hides loaded media on the first render of a pending replacement and after failure", async () => {
    const adapter = new ControlledBlobAdapter();
    const engine = createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), adapter);
    await engine.init();
    await engine.blobs.put("a", new Uint8Array([7]));
    await engine.blobs.put("b", new Uint8Array([8]));
    const pending = deferred();
    adapter.pending.set("b", pending.promise);
    const { result, rerender, renders } = renderBlobs(engine, "a");
    await waitFor(() => {
      expect(result.current.bytes).toEqual(new Uint8Array([7]));
      expect(result.current.url).toBe("blob:mock-url");
    });
    const previousUrl = result.current.url;
    const replacementRender = renders.length;

    rerender({ engine, id: "b" });
    expect(renders[replacementRender]).toEqual({ bytes: null, url: null });
    expect(result.current).toEqual({ bytes: null, url: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previousUrl);

    await act(async () => pending.reject(new Error("Read failed")));
    expect(result.current).toEqual({ bytes: null, url: null });
    expect(renders.slice(replacementRender)).toEqual(
      renders.slice(replacementRender).map(() => ({ bytes: null, url: null })),
    );
  });

  it("does not reuse loaded media when the engine changes with the same blob id", async () => {
    const first = makeEngine();
    const adapter = new ControlledBlobAdapter();
    const second = createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), adapter);
    await first.init();
    await second.init();
    await first.blobs.put("same", new Uint8Array([1]));
    await second.blobs.put("same", new Uint8Array([2]));
    const pending = deferred();
    adapter.pending.set("same", pending.promise);
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:engine-${++nextUrl}`);
    const { result, rerender, renders, unmount } = renderBlobs(first, "same");
    await waitFor(() => {
      expect(result.current.bytes).toEqual(new Uint8Array([1]));
      expect(result.current.url).toBe("blob:engine-1");
    });
    const replacementRender = renders.length;

    rerender({ engine: second, id: "same" });
    expect(renders[replacementRender]).toEqual({ bytes: null, url: null });
    expect(result.current).toEqual({ bytes: null, url: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:engine-1");

    await act(async () => pending.resolve());
    expect(result.current).toEqual({
      bytes: new Uint8Array([2]),
      url: "blob:engine-2",
    });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:engine-2");
  });

  it("ignores old results finishing after new results and revokes the late URL", async () => {
    const adapter = new ControlledBlobAdapter();
    const engine = createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), adapter);
    await engine.init();
    await engine.blobs.put("old", new Uint8Array([1]));
    await engine.blobs.put("new", new Uint8Array([2]));
    const pending = deferred();
    adapter.pending.set("old", pending.promise);
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:race-${++nextUrl}`);
    const { result, rerender, unmount } = renderBlobs(engine, "old");
    await act(async () => {});
    rerender({ engine, id: "new" });
    await waitFor(() => {
      expect(result.current.bytes).toEqual(new Uint8Array([2]));
      expect(result.current.url).toBe("blob:race-1");
    });

    await act(async () => pending.resolve());
    expect(result.current).toEqual({
      bytes: new Uint8Array([2]),
      url: "blob:race-1",
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:race-2");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:race-1");
  });

  it("clears media before null effects and does not resurrect its revoked URL on return", async () => {
    const adapter = new ControlledBlobAdapter();
    const engine = createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), adapter);
    await engine.init();
    await engine.blobs.put("a", new Uint8Array([3]));
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:null-${++nextUrl}`);
    const { result, rerender, renders, unmount } = renderBlobs(engine, "a");
    await waitFor(() => {
      expect(result.current.bytes).toEqual(new Uint8Array([3]));
      expect(result.current.url).toBe("blob:null-1");
    });
    const nullRender = renders.length;

    rerender({ engine, id: null });
    expect(renders[nullRender]).toEqual({ bytes: null, url: null });
    expect(result.current).toEqual({ bytes: null, url: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:null-1");

    const pending = deferred();
    adapter.pending.set("a", pending.promise);
    rerender({ engine, id: "a" });
    expect(result.current).toEqual({ bytes: null, url: null });
    unmount();
    await act(async () => pending.resolve());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:null-2");
  });

  it("keeps committed media valid when a transition to a suspended key is abandoned", async () => {
    const adapter = new ControlledBlobAdapter();
    const engine = createEngine(new NodeSqliteAdapter({ vfs: { type: "memory" } }), adapter);
    await engine.init();
    await engine.blobs.put("a", new Uint8Array([4]));
    const read = deferred();
    const suspended = deferred();
    adapter.pending.set("a", read.promise);
    vi.mocked(URL.createObjectURL).mockImplementation(() => "blob:committed-a");

    function App(): ReactNode {
      const [id, setId] = useState("a");
      const bytes = useBlob(engine, id);
      const url = useBlobUrl(engine, id);
      if (id === "b") throw suspended.promise;
      return (
        <>
          <div data-testid="committed">
            {bytes ? [...bytes].join(",") : "empty"}|{url ?? "empty"}
          </div>
          <button type="button" onClick={() => startTransition(() => setId("b"))}>
            Suspend on B
          </button>
        </>
      );
    }

    const { getByRole, getByTestId } = render(
      <Suspense fallback={<div>Loading</div>}>
        <App />
      </Suspense>,
    );
    act(() => getByRole("button", { name: "Suspend on B" }).click());
    expect(getByTestId("committed").textContent).toBe("empty|empty");

    await act(async () => read.resolve());
    await waitFor(() => expect(getByTestId("committed").textContent).toBe("4|blob:committed-a"));
  });
});
