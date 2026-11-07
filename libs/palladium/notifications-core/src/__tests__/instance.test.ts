import { describe, expect, it, vi } from "vitest";
import type { NotificationInteractionHandler } from "../channel.js";
import { createNotifications } from "../instance.js";
import { MockChannel } from "../mock.js";

// happy-dom / jsdom provides window, but we need to test SSR guard
function withNoWindow<T>(fn: () => T): T {
  const original = (globalThis as Record<string, unknown>)["window"];
  Object.defineProperty(globalThis, "window", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

describe("createNotifications", () => {
  it("getChannel() returns configured channel", () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    expect(inst.getChannel("toast")).toBe(toast);
  });

  it("getChannel() returns undefined for unconfigured channel", () => {
    const inst = createNotifications();
    expect(inst.getChannel("browser")).toBeUndefined();
  });

  it("send to single channel returns delivered", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    const result = await inst.notify("Hello").via("toast").send();
    expect(result.delivered).toContain("toast");
    expect(result.failed).toHaveLength(0);
  });

  it("send to multiple channels delivers to both", async () => {
    const toast = new MockChannel("toast");
    const browser = new MockChannel("browser");
    const inst = createNotifications({ channels: { toast, browser } });
    const result = await inst.notify("Hello").via("toast", "browser").send();
    expect(result.delivered).toContain("toast");
    expect(result.delivered).toContain("browser");
  });

  it("unconfigured channel returns skipped result", async () => {
    const inst = createNotifications();
    const result = await inst.notify("Hello").via("toast").send();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.channel).toBe("toast");
  });

  it("unavailable channel returns skipped result", async () => {
    const toast = new MockChannel("toast", { available: false });
    const inst = createNotifications({ channels: { toast } });
    const result = await inst.notify("Hello").via("toast").send();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.channel).toBe("toast");
  });

  it("channel that returns failed status is included in failed", async () => {
    const toast = new MockChannel("toast");
    toast.setBehavior("failed", { error: new Error("disk full") });
    const inst = createNotifications({ channels: { toast } });
    const result = await inst.notify("Hello").via("toast").send();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.channel).toBe("toast");
  });

  it("fallback: when primary fails, fallback channel delivers", async () => {
    const browser = new MockChannel("browser");
    browser.setBehavior("failed");
    const toast = new MockChannel("toast");
    const inst = createNotifications({
      channels: { browser, toast },
      fallback: ["toast"],
    });
    const result = await inst.notify("Hello").via("browser").send();
    expect(result.delivered).toContain("toast");
  });

  it("falls back and emits a channel error when permission request rejects", async () => {
    const browser = new MockChannel("browser", { permissionState: "default" });
    vi.spyOn(browser, "requestPermission").mockRejectedValue(new Error("permission unavailable"));
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { browser, toast }, fallback: ["toast"] });
    const onError = vi.fn();
    inst.on("error", onError);

    const result = await inst.notify("Hello").via("browser").send();

    expect(result.delivered).toEqual(["toast"]);
    expect(result.failed).toEqual([
      { channel: "browser", error: expect.objectContaining({ message: "permission unavailable" }) },
    ]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "browser", error: expect.any(Error) }),
    );
  });

  it("falls back when reading channel permission status throws", async () => {
    const browser = new MockChannel("browser");
    vi.spyOn(browser, "permissionStatus").mockImplementation(() => {
      throw new Error("permission status unavailable");
    });
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { browser, toast }, fallback: ["toast"] });

    const result = await inst.notify("Hello").via("browser").send();

    expect(result.delivered).toEqual(["toast"]);
    expect(result.failed[0]).toMatchObject({
      channel: "browser",
      error: expect.objectContaining({ message: "permission status unavailable" }),
    });
  });

  it("fallback: per-notification fallback overrides config fallback", async () => {
    const browser = new MockChannel("browser");
    browser.setBehavior("failed");
    const toast = new MockChannel("toast");
    const expo = new MockChannel("expo");
    const inst = createNotifications({
      channels: { browser, toast, expo },
      fallback: ["toast"],
    });
    const result = await inst.notify("Hello").via("browser").withFallback(["expo"]).send();
    expect(result.delivered).toContain("expo");
    expect(result.delivered).not.toContain("toast");
  });

  it("fallback not attempted when primary succeeds", async () => {
    const toast = new MockChannel("toast");
    const browser = new MockChannel("browser");
    const inst = createNotifications({ channels: { toast, browser }, fallback: ["browser"] });
    await inst.notify("Hello").via("toast").send();
    expect(browser.sentNotifications).toHaveLength(0);
  });

  it("toast.success() sends to toast channel with success variant", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    await inst.toast.success("Saved!");
    expect(toast.sentNotifications).toHaveLength(1);
    const n = toast.sentNotifications[0];
    expect(n?.title).toBe("Saved!");
    expect((n?.data as { variant: string } | undefined)?.variant).toBe("success");
  });

  it("toast.error() sends with urgency high", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    await inst.toast.error("Failed!");
    const n = toast.sentNotifications[0];
    expect(n?.urgency).toBe("high");
    expect((n?.data as { variant: string } | undefined)?.variant).toBe("error");
  });

  it("toast.warning() sends with warning variant", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    await inst.toast.warning("Heads up");
    const n = toast.sentNotifications[0];
    expect((n?.data as { variant: string } | undefined)?.variant).toBe("warning");
  });

  it("toast.info() sends with low urgency", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    await inst.toast.info("FYI");
    const n = toast.sentNotifications[0];
    expect(n?.urgency).toBe("low");
  });

  it("browser.requestPermission() delegates to browser channel", async () => {
    const browser = new MockChannel("browser", { permissionState: "granted" });
    const inst = createNotifications({ channels: { browser } });
    const result = await inst.browser.requestPermission();
    expect(result).toBe("granted");
  });

  it("browser.permissionStatus() returns not-applicable when no browser channel", () => {
    const inst = createNotifications();
    expect(inst.browser.permissionStatus()).toBe("not-applicable");
  });

  it("browser.requestPermission() returns not-applicable when no channel", async () => {
    const inst = createNotifications();
    const result = await inst.browser.requestPermission();
    expect(result).toBe("not-applicable");
  });

  it.each(["granted", "denied"] as const)(
    "emits permission changes from instance requests (%s)",
    async (decision) => {
      const browser = new MockChannel("browser", { permissionState: "default" });
      vi.spyOn(browser, "requestPermission").mockImplementation(async () => {
        browser.setPermissionState(decision);
        return decision;
      });
      const inst = createNotifications({ channels: { browser } });
      inst.on("permissionchange", () => {
        throw new Error("permission observer failed");
      });
      const listener = vi.fn();
      inst.on("permissionchange", listener);
      await inst.requestPermission("browser");
      expect(listener).toHaveBeenCalledWith({ channel: "browser", permission: decision });
      expect(browser.sentNotifications).toEqual([]);
    },
  );

  it("rejects instance permission requests without emitting a transition", async () => {
    const browser = new MockChannel("browser", { permissionState: "default" });
    const error = new Error("permission request failed");
    vi.spyOn(browser, "requestPermission").mockRejectedValue(error);
    const inst = createNotifications({ channels: { browser } });
    const listener = vi.fn();
    inst.on("permissionchange", listener);
    await expect(inst.requestPermission("browser")).rejects.toBe(error);
    expect(listener).not.toHaveBeenCalled();
    expect(browser.sentNotifications).toEqual([]);
  });

  it.each(["granted", "denied"] as const)(
    "publishes automatic send-time permission %s even without delivery",
    async (decision) => {
      const browser = new MockChannel("browser", { permissionState: "default" });
      vi.spyOn(browser, "requestPermission").mockImplementation(async () => {
        browser.setPermissionState(decision);
        return decision;
      });
      const inst = createNotifications({ channels: { browser } });
      inst.on("permissionchange", () => {
        throw new Error("permission observer failed");
      });
      const permissions: string[] = [];
      inst.on("permissionchange", ({ permission }) => permissions.push(permission));
      const result = await inst.browser.send({ title: "permission first" });
      expect(permissions).toEqual([decision]);
      if (decision === "granted") {
        expect(result).toEqual({ delivered: ["browser"], failed: [], skipped: [] });
        expect(browser.sentNotifications).toEqual([{ title: "permission first" }]);
      } else {
        expect(result).toEqual({
          delivered: [],
          failed: [],
          skipped: [{ channel: "browser", reason: 'Permission not granted for channel "browser"' }],
        });
        expect(browser.sentNotifications).toEqual([]);
      }
    },
  );

  it("browser shorthand publishes the same permission event", async () => {
    const browser = new MockChannel("browser", { permissionState: "default" });
    vi.spyOn(browser, "requestPermission").mockImplementation(async () => {
      browser.setPermissionState("denied");
      return "denied";
    });
    const inst = createNotifications({ channels: { browser } });
    const listener = vi.fn();
    inst.on("permissionchange", listener);
    await inst.browser.requestPermission();
    expect(listener).toHaveBeenCalledWith({ channel: "browser", permission: "denied" });
  });
  it("returns not-applicable from the instance API for absent channels without a transition", async () => {
    const inst = createNotifications();
    const listener = vi.fn();
    inst.on("permissionchange", listener);
    await expect(inst.requestPermission("browser")).resolves.toBe("not-applicable");
    expect(listener).not.toHaveBeenCalled();
  });

  it("use() middleware can transform notification", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    inst.use(async (ctx, next) => {
      await next({ ...ctx, notification: { ...ctx.notification, title: "Enriched" } });
    });
    await inst.notify("Original").via("toast").send();
    expect(toast.sentNotifications[0]?.title).toBe("Enriched");
  });

  it("use() middleware suppression returns all-skipped", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    inst.use(async (_ctx, _next) => {
      // suppress — do not call next
    });
    const result = await inst.notify("Hello").via("toast").send();
    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("suppressed");
    expect(toast.sentNotifications).toHaveLength(0);
  });

  it("on('beforesend') fires before send", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    const handler = vi.fn();
    inst.on("beforesend", handler);
    await inst.notify("Hi").via("toast").send();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ notification: expect.objectContaining({ title: "Hi" }) }),
    );
  });

  it("on('delivered') fires after delivery", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    const handler = vi.fn();
    inst.on("delivered", handler);
    await inst.notify("Hi").via("toast").send();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ channel: "toast" }));
  });

  it("on('error') fires on channel failure", async () => {
    const toast = new MockChannel("toast");
    toast.setBehavior("failed", { error: new Error("oops") });
    const inst = createNotifications({ channels: { toast } });
    const handler = vi.fn();
    inst.on("error", handler);
    await inst.notify("Hi").via("toast").send();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "toast", error: expect.any(Error) }),
    );
  });

  it("permission auto-request: calls requestPermission when status is default", async () => {
    const toast = new MockChannel("toast", { permissionState: "default" });
    const requestSpy = vi.spyOn(toast, "requestPermission").mockResolvedValue("granted");
    const inst = createNotifications({ channels: { toast } });
    await inst.notify("Hi").via("toast").send();
    expect(requestSpy).toHaveBeenCalled();
  });

  it("SSR: all channels skipped when window is undefined", async () => {
    const toast = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast } });
    const result = await new Promise<Awaited<ReturnType<typeof inst._send>>>((resolve) => {
      withNoWindow(() => {
        resolve(inst.notify("Hello").via("toast").send());
      });
    });
    expect(result.skipped[0]?.reason).toContain("SSR");
    expect(toast.sentNotifications).toHaveLength(0);
  });

  it("sends to all configured channels when no via() specified", async () => {
    const toast = new MockChannel("toast");
    const browser = new MockChannel("browser");
    const inst = createNotifications({ channels: { toast, browser } });
    const result = await inst.notify("Hello").send();
    expect(result.delivered).toContain("toast");
    expect(result.delivered).toContain("browser");
  });
  it("does not send when middleware resumes after disposal", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const channel = new MockChannel("toast");
    const instance = createNotifications({ channels: { toast: channel } });
    instance.use(async (context, next) => {
      await gate;
      await next(context);
    });
    const send = instance.notify("Late").via("toast").send();
    await instance.dispose();
    resume();
    await send;
    expect(channel.sentNotifications).toEqual([]);
  });

  it("removes every interaction owner for aliased channels and retries failed cleanup", async () => {
    let interactionHandler:
      | {
          clicked: (notification: { title: string }) => void;
          dismissed: (notification: { title: string }) => void;
        }
      | undefined;
    const removeHandler = vi.fn((handler: typeof interactionHandler) => {
      interactionHandler = handler;
    });
    const dispose = vi
      .fn()
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockResolvedValue(undefined);
    const channel = {
      name: "toast" as const,
      send: vi.fn().mockResolvedValue({ status: "delivered" as const }),
      requestPermission: vi.fn().mockResolvedValue("granted" as const),
      permissionStatus: () => "granted" as const,
      isAvailable: () => true,
      setInteractionHandler: removeHandler,
      dispose,
    };
    const instance = createNotifications({
      channels: { toast: channel, browser: channel },
    });
    const clicked = vi.fn();
    instance.on("clicked", clicked);
    instance.on("clicked", () => {
      throw new Error("observer failed");
    });
    interactionHandler?.clicked({ title: "Before" });
    expect(clicked).toHaveBeenCalledTimes(2);
    await expect(instance.dispose()).rejects.toThrow("cleanup failed");
    expect(removeHandler).toHaveBeenLastCalledWith(undefined);
    interactionHandler?.clicked({ title: "After first cleanup" });
    expect(clicked).toHaveBeenCalledTimes(2);
    await instance.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("preserves a later owner while an earlier disposal is awaiting cleanup", async () => {
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    let handler: NotificationInteractionHandler | undefined;
    const channel = {
      name: "toast" as const,
      send: async () => ({ status: "delivered" as const }),
      requestPermission: async () => "granted" as const,
      permissionStatus: () => "granted" as const,
      isAvailable: () => true,
      setInteractionHandler(next: NotificationInteractionHandler | undefined) {
        handler = next;
      },
      dispose: () => removal,
    };
    const first = createNotifications({ channels: { toast: channel } });
    const disposing = first.dispose();
    const second = createNotifications({ channels: { toast: channel } });
    const titles: string[] = [];
    second.on("clicked", ({ notification }) => titles.push(notification.title));
    finishRemoval();
    await disposing;
    handler?.clicked({ title: "Current owner" });
    expect(titles).toEqual(["Current owner"]);
    await second.dispose();
    handler?.clicked({ title: "After final disposal" });
    expect(titles).toEqual(["Current owner"]);
  });
});
