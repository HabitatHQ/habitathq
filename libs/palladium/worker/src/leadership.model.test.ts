import { afterEach, describe, expect, it, vi } from "vitest";
import { type LeadershipDecision, type LockRequester, whileLeader } from "./leadership.js";

type AttemptOutcome = "request-failure" | LeadershipDecision;

interface PendingRequest {
  readonly contender: string;
  readonly callback: () => Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

const SEEDS = [0x1a2b3c4d, 0x5eed1234, 0xc0ffee42, 0xf00dba5e] as const;
const CONTENDER_COUNT = 2;

function generateSchedule(seed: number): AttemptOutcome[] {
  let state = seed >>> 0;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  const generatedPrefix = Array.from(
    { length: 2 + (next() % 5) },
    (): AttemptOutcome => ((next() & 1) === 0 ? "request-failure" : "release"),
  );

  return ["request-failure", "release", ...generatedPrefix, "hold"];
}

class DeterministicLockModel {
  readonly errors: unknown[] = [];
  readonly heldOwners = new Set<string>();
  readonly promotions: Array<{
    readonly contender: string;
    readonly decision: LeadershipDecision;
  }> = [];
  readonly trace: string[] = [];

  #activeOwners = 0;
  #maximumActiveOwners = 0;
  #pending: PendingRequest[] = [];
  #scheduledDecision = new Map<string, LeadershipDecision>();

  get maximumActiveOwners(): number {
    return this.#maximumActiveOwners;
  }

  get pendingRequests(): number {
    return this.#pending.length;
  }

  requesterFor(contender: string): LockRequester {
    return {
      request: (_name, _options, callback) =>
        new Promise<void>((resolve, reject) => {
          this.trace.push(`queued:${contender}`);
          this.#pending.push({ contender, callback, resolve, reject });
        }),
    };
  }

  onAcquired(contender: string): LeadershipDecision {
    const decision = this.#scheduledDecision.get(contender);
    if (decision === undefined) {
      throw new Error(`No generated promotion decision for ${contender}`);
    }
    this.#scheduledDecision.delete(contender);
    this.promotions.push({ contender, decision });
    this.trace.push(`promoted:${contender}:${decision}`);
    if (decision === "hold") this.heldOwners.add(contender);
    return decision;
  }

  async grantNext(outcome: AttemptOutcome): Promise<void> {
    const pending = this.#pending.shift();
    if (pending === undefined) {
      throw new Error(`Generated outcome ${outcome} has no queued lock request`);
    }

    if (outcome === "request-failure") {
      const error = new Error(`transient lock request failure for ${pending.contender}`);
      this.trace.push(`request-failed:${pending.contender}`);
      pending.reject(error);
      await Promise.resolve();
      return;
    }

    if (this.#activeOwners !== 0) {
      throw new Error(`Lock granted concurrently to ${pending.contender}`);
    }

    this.#activeOwners += 1;
    this.#maximumActiveOwners = Math.max(this.#maximumActiveOwners, this.#activeOwners);
    this.#scheduledDecision.set(pending.contender, outcome);
    this.trace.push(`acquired:${pending.contender}`);

    const callback = pending.callback();
    await Promise.resolve();
    if (outcome === "hold") return;

    await callback;
    this.#activeOwners -= 1;
    this.trace.push(`released:${pending.contender}`);
    pending.resolve();
    await Promise.resolve();
  }
}

function replayContext(
  seed: number,
  schedule: readonly AttemptOutcome[],
  model: DeterministicLockModel,
): string {
  return `seed=0x${seed.toString(16)} schedule=${schedule.join(",")} trace=${model.trace.join(" -> ")}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("whileLeader generated leadership schedules", () => {
  it.each(
    SEEDS,
  )("retries bounded failures and releases to one exclusive holder (seed %#)", async (seed) => {
    vi.useFakeTimers();
    const schedule = generateSchedule(seed);
    const model = new DeterministicLockModel();

    for (let index = 0; index < CONTENDER_COUNT; index += 1) {
      const contender = `worker-${index}`;
      whileLeader("palladium-leader:model", async () => model.onAcquired(contender), {
        locks: model.requesterFor(contender),
        retryDelayMs: 0,
        onError: (error) => {
          model.errors.push(error);
        },
      });
    }

    await Promise.resolve();
    for (const outcome of schedule) {
      if (model.pendingRequests === 0) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(model.pendingRequests, replayContext(seed, schedule, model)).toBeGreaterThan(0);
      await model.grantNext(outcome);
      await Promise.resolve();
    }

    const context = replayContext(seed, schedule, model);
    const decisions = model.promotions.map(({ decision }) => decision);
    const holdIndex = decisions.indexOf("hold");

    expect(schedule.at(-1), context).toBe("hold");
    expect(model.errors.length, context).toBeGreaterThan(0);
    expect(decisions.slice(0, holdIndex), context).toContain("release");
    expect(holdIndex, context).toBe(decisions.length - 1);
    expect(model.heldOwners.size, context).toBe(1);
    expect(model.maximumActiveOwners, context).toBe(1);
  });
});
