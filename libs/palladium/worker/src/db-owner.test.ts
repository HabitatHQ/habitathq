import type { Endpoint } from "comlink";
import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, createClient } from "./client.js";
import {
  leaderAnnouncementRequiresConnection,
  startDbOwner,
  type WorkerDiagnostic,
  type WorkerFacade,
} from "./db-owner.js";
import type { LockRequester } from "./leadership.js";

const LEADER = "leader-worker";
const EPOCH = "leader-epoch";

describe("leaderAnnouncementRequiresConnection", () => {
  it("reconnects when a timed-out proxy receives the incumbent's same-epoch announcement", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, false, {
        type: "leader",
        epoch: EPOCH,
        leader: LEADER,
      }),
    ).toBe(true);
  });

  it("does not rebuild a healthy proxy for a duplicate announcement", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: EPOCH,
        leader: LEADER,
      }),
    ).toBe(false);
  });

  it("reconnects when either the leader or leadership term changes", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: "next-epoch",
        leader: LEADER,
      }),
    ).toBe(true);
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: EPOCH,
        leader: "replacement-worker",
      }),
    ).toBe(true);
  });
});

class MessageInbox {
  readonly listeners = new Set<EventListenerOrEventListenerObject>();
  readonly transferredPorts = new Set<MessagePort>();
  closed = false;

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.delete(listener);
  }

  deliver(data: unknown, transfer: Transferable[] = []): void {
    const cloned = structuredClone(data, { transfer });
    this.collectPorts(cloned);
    queueMicrotask(() => {
      if (this.closed) return;
      const event = new MessageEvent("message", { data: cloned });
      for (const listener of [...this.listeners]) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    });
  }

  private collectPorts(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("postMessage" in value && "close" in value && typeof value.close === "function") {
      this.transferredPorts.add(value as MessagePort);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) this.collectPorts(item);
      return;
    }
    for (const item of Object.values(value)) this.collectPorts(item);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    for (const port of this.transferredPorts) port.close();
    this.transferredPorts.clear();
  }
}

class ControlledBroadcastChannel extends MessageInbox {
  static readonly channels = new Set<ControlledBroadcastChannel>();

  constructor(readonly name: string) {
    super();
    ControlledBroadcastChannel.channels.add(this);
  }

  postMessage(data: unknown, transfer?: Transferable[]): void {
    if (this.closed) throw new Error("BroadcastChannel is closed");
    for (const channel of ControlledBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name) channel.deliver(data, transfer);
    }
  }

  override close(): void {
    super.close();
    ControlledBroadcastChannel.channels.delete(this);
  }
}

interface WorkerRealm {
  readonly worker: MessageInbox;
  readonly main: MessageInbox;
  readonly mainEndpoint: Endpoint;
}

// Route real Comlink frames between two dedicated-worker inboxes in one test
// realm. Neither Comlink.expose/wrap nor the owner implementation is mocked.
function installWorkerInterfaces(): {
  start(startOwner: () => void): WorkerRealm;
  close(): void;
} {
  const realms: WorkerRealm[] = [];
  const replyRoutes = new Map<string, WorkerRealm>();
  let startingRealm: WorkerRealm | undefined;
  let nextUuid = 0;
  let lockHeld = false;
  const locks: LockRequester = {
    request(_name, _options, callback) {
      if (!lockHeld) {
        lockHeld = true;
        void callback();
      }
      return new Promise<void>(() => {});
    },
  };

  vi.stubGlobal("navigator", { locks });
  vi.stubGlobal("BroadcastChannel", ControlledBroadcastChannel);
  vi.stubGlobal("crypto", { randomUUID: () => `worker-${++nextUuid}` });
  vi.stubGlobal(
    "addEventListener",
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (!startingRealm) throw new Error("Worker listener registered outside owner startup");
      startingRealm.worker.addEventListener(type, listener);
    },
  );
  vi.stubGlobal(
    "removeEventListener",
    (type: string, listener: EventListenerOrEventListenerObject) => {
      for (const realm of realms) realm.worker.removeEventListener(type, listener);
    },
  );
  vi.stubGlobal("postMessage", (data: { id: string }, transfer?: Transferable[]) => {
    const realm = replyRoutes.get(data.id);
    if (!realm) throw new Error(`No worker route for Comlink reply ${data.id}`);
    replyRoutes.delete(data.id);
    realm.main.deliver(data, transfer);
  });

  return {
    start(startOwner) {
      const worker = new MessageInbox();
      const main = new MessageInbox();
      const realm: WorkerRealm = {
        worker,
        main,
        mainEndpoint: {
          postMessage(data: { id: string }, transfer?: Transferable[]) {
            replyRoutes.set(data.id, realm);
            worker.deliver(data, transfer);
          },
          addEventListener: main.addEventListener.bind(main),
          removeEventListener: main.removeEventListener.bind(main),
        },
      };
      realms.push(realm);
      startingRealm = realm;
      try {
        startOwner();
      } finally {
        startingRealm = undefined;
      }
      return realm;
    },
    close() {
      for (const channel of [...ControlledBroadcastChannel.channels]) channel.close();
      for (const realm of realms) {
        realm.worker.close();
        realm.main.close();
      }
      realms.length = 0;
      replyRoutes.clear();
      // Do not resolve lifetime-held/queued locks: that restarts whileLeader.
      // Dropping inboxes models worker termination without external handles.
    },
  };
}
async function waitForCount<T>(items: T[], count: number): Promise<void> {
  await vi.waitFor(() => expect(items).toHaveLength(count));
}

let disposeWorkers: (() => void) | undefined;

afterEach(() => {
  disposeWorkers?.();
  disposeWorkers = undefined;
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type CounterService = {
  increment(): Promise<number>;
  read(): Promise<number>;
  fail(): Promise<void>;
};

describe("startDbOwner public Comlink calls", () => {
  it("rejects an outcome-unknown timeout without replaying the committed invocation", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(0);
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    const followerDiagnostics: WorkerDiagnostic[] = [];
    const commits: Array<{ atMs: number; count: number }> = [];
    let count = 0;
    let serviceCreates = 0;
    let failedCalls = 0;
    let firstReplyCompleted = false;

    const leader = workers.start(() => {
      startDbOwner<CounterService>({
        dbName: "timeout-outcome",
        methods: ["increment", "read", "fail"],
        create: () => {
          serviceCreates += 1;
          return {
            async open() {},
            async increment() {
              const committedCount = ++count;
              commits.push({ atMs: Date.now(), count: committedCount });
              if (committedCount === 1) {
                await new Promise<void>((resolve) => setTimeout(resolve, 10_500));
                firstReplyCompleted = true;
              }
              return committedCount;
            },
            async read() {
              return count;
            },
            async fail() {
              failedCalls += 1;
              throw new Error("application rejected the operation");
            },
          };
        },
      });
    });
    const follower = workers.start(() => {
      startDbOwner<CounterService>({
        dbName: "timeout-outcome",
        methods: ["increment", "read", "fail"],
        onDiagnostic: (diagnostic) => followerDiagnostics.push(diagnostic),
        create: () => {
          throw new Error("Queued follower must not acquire the incumbent's lock");
        },
      });
    });
    await vi.advanceTimersByTimeAsync(0);

    const proxy = Comlink.wrap<WorkerFacade<CounterService>>(follower.mainEndpoint);
    // Capture rejection immediately: a timeout must not create an unhandled
    // rejection while fake time advances through the original late reply.
    const outcome = proxy.increment().then(
      (value) => ({ kind: "result" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toEqual([{ atMs: 0, count: 1 }]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(firstReplyCompleted).toBe(false);
    await vi.advanceTimersByTimeAsync(501);

    // Includes the old 10,200 ms retry window and the first 10,500 ms reply.
    expect(commits).toEqual([{ atMs: 0, count: 1 }]);
    expect(firstReplyCompleted).toBe(true);
    expect(await outcome).toMatchObject({
      kind: "error",
      error: {
        name: "OutcomeUnknownError",
        message: expect.stringContaining("outcome is unknown"),
      },
    });
    expect(followerDiagnostics.filter(({ event }) => event === "leader_rpc_timeout")).toMatchObject(
      [{ elapsedMs: 10_000 }],
    );

    // A distinct invocation may rediscover the SAME live owner and execute.
    const next = proxy.increment();
    await vi.advanceTimersByTimeAsync(200);
    await expect(next).resolves.toBe(2);
    expect(commits).toEqual([
      { atMs: 0, count: 1 },
      { atMs: 10_700, count: 2 },
    ]);
    expect(serviceCreates).toBe(1);
    expect(
      followerDiagnostics
        .filter(({ event }) => event === "leader_discovered")
        .map(({ leaderId, epoch }) => ({ leaderId, epoch })),
    ).toEqual([
      { leaderId: "worker-1", epoch: "worker-3" },
      { leaderId: "worker-1", epoch: "worker-3" },
    ]);

    const read = proxy.read();
    await vi.advanceTimersByTimeAsync(0);
    await expect(read).resolves.toBe(2);
    const failed = proxy.fail().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(await failed).toMatchObject({ message: "application rejected the operation" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(failedCalls).toBe(1);
    expect(count).toBe(2);

    const localProxy = Comlink.wrap<WorkerFacade<CounterService>>(leader.mainEndpoint);
    const local = localProxy.increment();
    await vi.advanceTimersByTimeAsync(0);
    await expect(local).resolves.toBe(3);
    proxy[Comlink.releaseProxy]();
    localProxy[Comlink.releaseProxy]();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("worker subscription ownership over Comlink", () => {
  it("isolates asynchronous subscriber failure without orphaning its rejection", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let invalidate: ((tables: readonly string[]) => void) | undefined;
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "subscriber-failure",
        methods: ["barrier"],
        create(ctx) {
          invalidate = ctx.invalidate;
          return { async open() {}, async barrier() {} };
        },
      });
    });
    const connection = connect<{ barrier(): Promise<void> }>(
      realm.mainEndpoint as unknown as Worker,
    );
    const failure = new Error("subscriber failed");
    const stopFailing = connection.onInvalidate(async () => {
      throw failure;
    });
    const tables: string[][] = [];
    const stopHealthy = connection.onInvalidate((changed) => tables.push([...changed]));
    await connection.service.barrier();
    invalidate?.(["notes"]);
    await waitForCount(tables, 1);
    expect(tables).toEqual([["notes"]]);
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: failure.message }),
      ),
    );
    stopFailing();
    stopHealthy();
  });

  it.each(["rows", "error"])(
    "owns an asynchronous live-query %s callback failure",
    async (outcome) => {
      const workers = installWorkerInterfaces();
      disposeWorkers = workers.close;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const realm = workers.start(() => {
        startDbOwner({
          dbName: "live-callback-failure",
          methods: ["query"],
          create() {
            return {
              async open() {},
              async query() {
                if (outcome === "error") throw new Error("query failed");
                return [{ value: 42 }];
              },
            };
          },
        });
      });
      const failure = new Error("live observer failed");
      const rejectCallback = async () => {
        throw failure;
      };
      const client = createClient(realm.mainEndpoint as unknown as Worker);
      const stop = client.live("select value", [], rejectCallback, rejectCallback);
      await vi.waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ message: failure.message }),
        ),
      );
      stop();
    },
  );

  it("fans out invalidations to independent subscriptions and removes only the unsubscribed listener", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    let invalidate: ((tables: readonly string[]) => void) | undefined;
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "subscription-fanout",
        methods: [],
        create(ctx) {
          invalidate = ctx.invalidate;
          return { async open() {} };
        },
      });
    });
    await vi.waitFor(() => expect(invalidate).toBeTypeOf("function"));
    const bus = Comlink.wrap<WorkerFacade<Record<string, never>>>(realm.mainEndpoint);
    const first: string[][] = [];
    const second: string[][] = [];
    await Promise.all([
      bus.onInvalidate(
        "first",
        Comlink.proxy((tables) => first.push([...tables])),
      ),
      bus.onInvalidate(
        "second",
        Comlink.proxy((tables) => second.push([...tables])),
      ),
    ]);
    invalidate?.(["notes"]);
    await waitForCount(first, 1);
    await waitForCount(second, 1);
    await bus.offInvalidate("first");
    await bus.offInvalidate("first");
    invalidate?.(["lists"]);
    await waitForCount(second, 2);
    expect(first).toEqual([["notes"]]);
    expect(second).toEqual([["notes"], ["lists"]]);
  });

  it("broadcasts invalidations from the leader to follower subscriptions", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    let invalidate: ((tables: readonly string[]) => void) | undefined;
    workers.start(() => {
      startDbOwner({
        dbName: "follower-invalidation",
        methods: [],
        create(ctx) {
          invalidate = ctx.invalidate;
          return { async open() {} };
        },
      });
    });
    const follower = workers.start(() => {
      startDbOwner({
        dbName: "follower-invalidation",
        methods: [],
        create() {
          throw new Error("the follower must not acquire the leader lock");
        },
      });
    });
    await vi.waitFor(() => expect(invalidate).toBeTypeOf("function"));
    const bus = Comlink.wrap<WorkerFacade<Record<string, never>>>(follower.mainEndpoint);
    const tables: string[][] = [];
    await bus.onInvalidate(
      "follower",
      Comlink.proxy((changed) => tables.push([...changed])),
    );
    invalidate?.(["notes"]);
    await waitForCount(tables, 1);
    expect(tables).toEqual([["notes"]]);
  });

  it.each(["promotion", "error"])(
    "fans out %s events to listeners registered before startup settles",
    async (outcome) => {
      const workers = installWorkerInterfaces();
      disposeWorkers = workers.close;
      const roleEvents: [string[], string[]] = [[], []];
      const errors: [string[], string[]] = [[], []];
      let finishOpen!: () => void;
      const opening = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      const realm = workers.start(() => {
        startDbOwner({
          dbName: "role-error-fanout",
          methods: [],
          create() {
            return {
              async open() {
                await opening;
                if (outcome === "error") throw new Error("open failed");
              },
            };
          },
        });
      });
      const bus = Comlink.wrap<WorkerFacade<Record<string, never>>>(realm.mainEndpoint);
      await Promise.all([
        bus.onRole(
          "role-a",
          Comlink.proxy((role) => roleEvents[0].push(role)),
        ),
        bus.onRole(
          "role-b",
          Comlink.proxy((role) => roleEvents[1].push(role)),
        ),
        bus.onError(
          "error-a",
          Comlink.proxy((message) => errors[0].push(message)),
        ),
        bus.onError(
          "error-b",
          Comlink.proxy((message) => errors[1].push(message)),
        ),
      ]);
      await vi.waitFor(() => expect(roleEvents[0]).toHaveLength(1));
      await vi.waitFor(() => expect(roleEvents[1]).toHaveLength(1));
      finishOpen();
      if (outcome === "promotion") {
        await waitForCount(roleEvents[0], 2);
        await waitForCount(roleEvents[1], 2);
        expect(roleEvents).toEqual([
          ["follower", "leader"],
          ["follower", "leader"],
        ]);
        expect(errors).toEqual([[], []]);
      } else {
        await waitForCount(errors[0], 1);
        await waitForCount(errors[1], 1);
        expect(errors).toEqual([["open failed"], ["open failed"]]);
        expect(roleEvents).toEqual([["follower"], ["follower"]]);
      }
      await bus.offRole("role-a");
      await bus.offError("error-a");
    },
  );

  it("replays only the latest 20 diagnostics and supports ID-based cleanup", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    let startupFailed = false;
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "diagnostic-replay",
        methods: [],
        create() {
          return {
            async open() {
              startupFailed = true;
              throw new Error("open failed");
            },
          };
        },
      });
    });
    await vi.waitFor(() => expect(startupFailed).toBe(true));
    const ownerChannel = [...ControlledBroadcastChannel.channels].find(
      (channel) => channel.name === "palladium:diagnostic-replay",
    );
    expect(ownerChannel).toBeDefined();
    for (let i = 0; i < 25; i += 1) {
      ownerChannel?.deliver({
        type: "leader",
        epoch: `epoch-${i}`,
        leader: `leader-${i}`,
      });
      await Promise.resolve();
    }
    const bus = Comlink.wrap<WorkerFacade<Record<string, never>>>(realm.mainEndpoint);
    const first: WorkerDiagnostic[] = [];
    const second: WorkerDiagnostic[] = [];
    await bus.onDiagnostic(
      "diagnostic-a",
      Comlink.proxy((d) => first.push(d)),
    );
    await bus.onDiagnostic(
      "diagnostic-b",
      Comlink.proxy((d) => second.push(d)),
    );
    await waitForCount(first, 20);
    await waitForCount(second, 20);
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    await bus.offDiagnostic("diagnostic-a");
    await bus.offDiagnostic("diagnostic-a");
    ownerChannel?.deliver({
      type: "leader",
      epoch: "epoch-after-unsubscribe",
      leader: "leader-after-unsubscribe",
    });
    await waitForCount(second, 21);
    expect(first).toHaveLength(20);
    expect(second[20]?.event).toBe("leader_discovered");
  });

  it("keeps invalidation subscriptions for two live queries independent", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    const pending: Array<(rows: Array<{ value: number }>) => void> = [];
    let invalidate: ((tables: readonly string[]) => void) | undefined;
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "two-live-queries",
        methods: ["query"],
        create(ctx) {
          invalidate = ctx.invalidate;
          return {
            async open() {},
            query: () => new Promise<Array<{ value: number }>>((resolve) => pending.push(resolve)),
          };
        },
      });
    });
    await vi.waitFor(() => expect(invalidate).toBeTypeOf("function"));
    const client = createClient(realm.mainEndpoint as unknown as Worker);
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = client.live<{ value: number }>("select first", [], (rows) =>
      first.push(rows[0]?.value ?? -1),
    );
    const stopSecond = client.live<{ value: number }>("select second", [], (rows) =>
      second.push(rows[0]?.value ?? -1),
    );
    await waitForCount(pending, 2);
    pending[0]?.([{ value: 1 }]);
    pending[1]?.([{ value: 2 }]);
    await waitForCount(first, 1);
    await waitForCount(second, 1);
    invalidate?.(["notes"]);
    await waitForCount(pending, 4);
    expect(pending).toHaveLength(4);
    pending[2]?.([{ value: 3 }]);
    pending[3]?.([{ value: 4 }]);
    await waitForCount(first, 2);
    await waitForCount(second, 2);
    stopFirst();
    stopSecond();
    expect(first).toEqual([1, 3]);
    expect(second).toEqual([2, 4]);
  });

  it("does not publish live query completions after unsubscribe or let older results overwrite newer ones", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    const pending: Array<(rows: Array<{ value: number }>) => void> = [];
    let invalidate: ((tables: readonly string[]) => void) | undefined;
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "live-query-order",
        methods: ["query"],
        create(ctx) {
          invalidate = ctx.invalidate;
          return {
            async open() {},
            query: (sql: string) =>
              sql === "barrier"
                ? Promise.resolve([{ value: 0 }])
                : new Promise<Array<{ value: number }>>((resolve) => pending.push(resolve)),
          };
        },
      });
    });
    await vi.waitFor(() => expect(invalidate).toBeTypeOf("function"));
    const client = createClient(realm.mainEndpoint as unknown as Worker);
    const results: number[] = [];
    const stop = client.live<{ value: number }>("select value", [], (rows) =>
      results.push(rows[0]?.value ?? -1),
    );
    await waitForCount(pending, 1);
    invalidate?.(["notes"]);
    await waitForCount(pending, 2);
    pending[1]?.([{ value: 2 }]);
    await waitForCount(results, 1);
    pending[0]?.([{ value: 1 }]);
    await client.query<{ value: number }>("barrier");
    invalidate?.(["notes"]);
    await waitForCount(pending, 3);
    stop();
    pending[2]?.([{ value: 3 }]);
    await client.query<{ value: number }>("barrier");
    expect(results).toEqual([2]);
  });

  it("reports active live query failures and ignores late rejection after unsubscribe", async () => {
    const workers = installWorkerInterfaces();
    disposeWorkers = workers.close;
    const pending: Array<(error: Error) => void> = [];
    const realm = workers.start(() => {
      startDbOwner({
        dbName: "live-query-errors",
        methods: ["query"],
        create() {
          return {
            async open() {},
            query: (sql: string) =>
              sql === "barrier"
                ? Promise.resolve([])
                : new Promise<never>((_resolve, reject) => pending.push(reject)),
          };
        },
      });
    });
    await vi.waitFor(() => expect(realm.worker.listeners.size).toBeGreaterThan(0));
    const client = createClient(realm.mainEndpoint as unknown as Worker);
    const failures: string[] = [];
    const stop = client.live(
      "select value",
      [],
      () => {},
      (error) => failures.push(error.message),
    );
    await waitForCount(pending, 1);
    pending[0]?.(new Error("active query failed"));
    await waitForCount(failures, 1);
    const stopLate = client.live(
      "select later",
      [],
      () => {},
      (error) => failures.push(error.message),
    );
    await waitForCount(pending, 2);
    stopLate();
    pending[1]?.(new Error("late query failed"));
    stop();
    await client.query("barrier");
    expect(failures).toEqual(["active query failed"]);
  });
});
