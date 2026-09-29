import { describe, expect, it, vi } from "vitest";
import { type LockRequester, whileLeader } from "./leadership.js";

describe("whileLeader", () => {
  it("requeues after a released promotion and eventually holds leadership", async () => {
    let promotions = 0;
    const locks: LockRequester = {
      async request(_name, _options, callback): Promise<void> {
        await callback();
      },
    };

    whileLeader(
      "palladium-leader:test",
      async () => {
        promotions += 1;
        return promotions === 1 ? "release" : "hold";
      },
      { locks, retryDelayMs: 0 },
    );

    await vi.waitFor(() => expect(promotions).toBe(2));
  });

  it("reports lock-request errors before retrying", async () => {
    const failure = new Error("temporary lock service failure");
    const onError = vi.fn();
    let requests = 0;
    const locks: LockRequester = {
      async request(_name, _options, callback): Promise<void> {
        requests += 1;
        if (requests === 1) throw failure;
        await callback();
      },
    };

    whileLeader("palladium-leader:test", async () => "hold", {
      locks,
      retryDelayMs: 0,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    await vi.waitFor(() => expect(requests).toBe(2));
  });
});
