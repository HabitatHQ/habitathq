import { describe, expect, it, vi } from "vitest";
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
  it("returns an instance with expected shape", () => {
    const inst = createNotifications();
    expect(typeof inst.notify).toBe("function");
    expect(typeof inst.use).toBe("function");
    expect(typeof inst.on).toBe("function");
    expect(typeof inst.getChannel).toBe("function");
    expect(typeof inst.toast).toBe("object");
    expect(typeof inst.browser).toBe("object");
  });

  it("notify() returns a NotificationBuilder with send()", () => {
    const inst = createNotifications();
    const builder = inst.notify("Hello");
    expect(typeof builder.send).toBe("function");
    expect(typeof builder.via).toBe("function");
  });

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
});
