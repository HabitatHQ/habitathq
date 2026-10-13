import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabasePlugin } from "../create-database-plugin.js";
import type { WorkerResponseEnvelope } from "../types.js";

type AnyListener = (event: MessageEvent) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly messageListeners = new Set<AnyListener>();
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: Array<Record<string, unknown>> = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "message", listener: AnyListener): void {
    if (type === "message") this.messageListeners.add(listener);
  }

  removeEventListener(type: "message", listener: AnyListener): void {
    if (type === "message") this.messageListeners.delete(listener);
  }

  postMessage(message: unknown): void {
    if (message && typeof message === "object") {
      this.posted.push(message as Record<string, unknown>);
    }
  }

  dispatch(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(new MessageEvent("message", { data: message }));
    }
  }

  triggerError(): void {
    this.onerror?.(new Event("error"));
  }

  static reset(): void {
    FakeWorker.instances = [];
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  FakeWorker.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDatabasePlugin — worker terminal failures", () => {
  it("rejects queued and future RPCs after INIT_ERROR and reports it once", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
    });

    const initPromise = initialize(false, onError);
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");
    const queued = sendToWorker<{ ok: true }>({ type: "QUERY" });

    worker.dispatch({ type: "INIT_ERROR", message: "open failed" });

    await initPromise;

    await expect(queued).rejects.toThrow("open failed");

    const future = sendToWorker<{ ok: true }>({ type: "QUERY" });
    await expect(future).rejects.toThrow("Database failed to start: open failed");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Database failed to start: open failed");
  });

  it("rejects queued and future RPCs after LOCK_UNAVAILABLE", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
    });

    const initPromise = initialize(false, onError);
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");
    const queued = sendToWorker<{ ok: true }>({ type: "QUERY" });

    worker.dispatch({ type: "LOCK_UNAVAILABLE" });

    await initPromise;

    await expect(queued).rejects.toThrow("already open in another tab");

    const future = sendToWorker<{ ok: true }>({ type: "QUERY" });
    await expect(future).rejects.toThrow("already open in another tab");

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("rejects queued and future RPCs after worker.onerror", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
    });

    const initPromise = initialize(false, onError);
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");
    const queued = sendToWorker<{ ok: true }>({ type: "QUERY" });

    worker.triggerError();

    await initPromise;

    await expect(queued).rejects.toThrow("Database worker crashed.");

    const future = sendToWorker<{ ok: true }>({ type: "QUERY" });
    await expect(future).rejects.toThrow("Database worker crashed.");

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("rejects queued and future RPCs after the startup timeout fires", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
      startupTimeoutMs: 1_000,
    });

    const initPromise = initialize(false, onError);
    const queued = sendToWorker<{ ok: true }>({ type: "QUERY" });

    vi.advanceTimersByTime(1_000);

    await initPromise;

    await expect(queued).rejects.toThrow("Database took too long to start.");

    const future = sendToWorker<{ ok: true }>({ type: "QUERY" });
    await expect(future).rejects.toThrow("Database took too long to start.");

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ignores a late READY after INIT_ERROR and keeps onError single-fired", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
    });

    const initPromise = initialize(false, onError);
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");
    const queued = sendToWorker<{ ok: true }>({ type: "QUERY" });

    worker.dispatch({ type: "INIT_ERROR", message: "open failed" });
    await initPromise;

    const late = sendToWorker<{ ok: true }>({ type: "QUERY" });
    worker.dispatch({ type: "READY" });
    worker.dispatch({ id: "fake", ok: true, data: { ok: true } } as WorkerResponseEnvelope);

    await expect(queued).rejects.toThrow("open failed");
    await expect(late).rejects.toThrow("Database failed to start: open failed");

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("createDatabasePlugin — native terminal failures", () => {
  it("rejects future RPCs and reports the native init rejection once", async () => {
    const onError = vi.fn();
    const initDeferred = defer<void>();
    const native = {
      init: vi.fn(() => initDeferred.promise),
      dispatch: vi.fn(),
    };

    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
      native,
    });

    const initPromise = initialize(true, onError);
    initDeferred.reject(new Error("native open failed"));
    await initPromise;

    await expect(sendToWorker<{ ok: true }>({ type: "QUERY" })).rejects.toThrow(
      /native open failed|unavailable|failed/i,
    );

    expect(native.init).toHaveBeenCalledTimes(1);
    expect(native.dispatch).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Database failed to start: native open failed");
  });
});

describe("createDatabasePlugin — success paths are unchanged", () => {
  it("resolves initialize on READY and routes RPCs through the worker", async () => {
    const onError = vi.fn();
    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
    });

    const initPromise = initialize(false, onError);
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");

    worker.dispatch({ type: "READY" });
    await initPromise;

    const response = sendToWorker<{ value: number }>({ type: "QUERY" });
    const firstPost = worker.posted[0];
    if (!firstPost || typeof firstPost["id"] !== "string") {
      throw new Error("expected a string id on the first posted message");
    }
    const id = firstPost["id"];
    worker.dispatch({ id, ok: true, data: { value: 42 } });

    await expect(response).resolves.toEqual({ value: 42 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("resolves native init and routes RPCs through the native dispatch bridge", async () => {
    const onError = vi.fn();
    const native = {
      init: vi.fn(async () => undefined),
      dispatch: vi.fn(async (req: unknown) => {
        const type = (req as { type?: unknown }).type;
        return { echoed: typeof type === "string" ? type : "unknown" };
      }),
    };

    const { initialize, sendToWorker } = createDatabasePlugin({
      appName: "TestApp",
      createWorker: () => new FakeWorker() as unknown as Worker,
      native,
    });

    await initialize(true, onError);

    await expect(sendToWorker<{ echoed: string }>({ type: "QUERY" })).resolves.toEqual({
      echoed: "QUERY",
    });

    expect(native.init).toHaveBeenCalledTimes(1);
    expect(native.dispatch).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
