import type { Endpoint } from "comlink";
import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  closed = false;

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.delete(listener);
  }

  deliver(data: unknown): void {
    const cloned = structuredClone(data);
    queueMicrotask(() => {
      if (this.closed) return;
      const event = new MessageEvent("message", { data: cloned });
      for (const listener of [...this.listeners]) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

class ControlledBroadcastChannel extends MessageInbox {
  static readonly channels = new Set<ControlledBroadcastChannel>();

  constructor(readonly name: string) {
    super();
    ControlledBroadcastChannel.channels.add(this);
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error("BroadcastChannel is closed");
    for (const channel of ControlledBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name) channel.deliver(data);
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
  vi.stubGlobal("postMessage", (data: { id: string }) => {
    const realm = replyRoutes.get(data.id);
    if (!realm) throw new Error(`No worker route for Comlink reply ${data.id}`);
    replyRoutes.delete(data.id);
    realm.main.deliver(data);
  });

  return {
    start(startOwner) {
      const worker = new MessageInbox();
      const main = new MessageInbox();
      const realm: WorkerRealm = {
        worker,
        main,
        mainEndpoint: {
          postMessage(data: { id: string }) {
            replyRoutes.set(data.id, realm);
            worker.deliver(data);
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

let disposeWorkers: (() => void) | undefined;

afterEach(() => {
  disposeWorkers?.();
  disposeWorkers = undefined;
  vi.clearAllTimers();
  vi.unstubAllGlobals();
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
