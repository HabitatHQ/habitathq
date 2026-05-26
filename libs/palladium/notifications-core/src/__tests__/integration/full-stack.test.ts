/**
 * Integration tests: full createNotifications() pipeline with real channel
 * implementations (no mocks).
 */

import { BrowserNotificationChannel } from "@palladium/notifications-browser";
import { ToastChannel } from "@palladium/notifications-toast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotifications, MockChannel } from "../../index.js";

// --- Mock Notification API (simulates browser environment) ---

interface MockNotifInstance {
  title: string;
  opts: NotificationOptions;
  onclick: ((e: Event) => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const notifInstances: MockNotifInstance[] = [];

class MockNotif {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi
    .fn<[], Promise<NotificationPermission>>()
    .mockResolvedValue("granted");
  title: string;
  opts: NotificationOptions;
  onclick: ((e: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();

  constructor(title: string, opts: NotificationOptions) {
    this.title = title;
    this.opts = opts;
    notifInstances.push(this);
  }
}

beforeEach(() => {
  notifInstances.length = 0;
  MockNotif.permission = "granted";
  MockNotif.requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("Notification", MockNotif);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Integration tests ---

describe("Full-stack: createNotifications() with BrowserNotificationChannel", () => {
  it("sends a browser notification end-to-end", async () => {
    const browser = new BrowserNotificationChannel();
    const inst = createNotifications({ channels: { browser } });

    const result = await inst
      .notify("Order shipped")
      .body("Your order is on the way")
      .icon("/truck.png")
      .via("browser")
      .send();

    expect(result.delivered).toContain("browser");
    expect(notifInstances).toHaveLength(1);
    expect(notifInstances[0]?.title).toBe("Order shipped");
    expect(notifInstances[0]?.opts.body).toBe("Your order is on the way");
  });

  it("falls back to toast when browser permission is denied", async () => {
    MockNotif.permission = "denied";
    const browser = new BrowserNotificationChannel();
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { browser, toast },
      fallback: ["toast"],
    });

    const result = await inst.notify("Update available").via("browser").send();

    expect(result.delivered).toContain("toast");
    expect(result.delivered).not.toContain("browser");
    expect(toast.headless.state.toasts).toHaveLength(1);
  });

  it("sends to browser + toast simultaneously", async () => {
    const browser = new BrowserNotificationChannel();
    const toast = new ToastChannel();
    const inst = createNotifications({ channels: { browser, toast } });

    const result = await inst.notify("New message").via("toast", "browser").send();

    expect(result.delivered).toContain("toast");
    expect(result.delivered).toContain("browser");
    expect(notifInstances).toHaveLength(1);
    expect(toast.headless.state.toasts).toHaveLength(1);
  });

  it("middleware enriches notification before delivery", async () => {
    const browser = new BrowserNotificationChannel();
    const inst = createNotifications({ channels: { browser } });

    inst.use(async (ctx, next) => {
      await next({
        ...ctx,
        notification: { ...ctx.notification, title: `[App] ${ctx.notification.title}` },
      });
    });

    await inst.notify("Hello").via("browser").send();
    expect(notifInstances[0]?.title).toBe("[App] Hello");
  });

  it("events fire in order: beforesend → delivered", async () => {
    const browser = new BrowserNotificationChannel();
    const inst = createNotifications({ channels: { browser } });
    const events: string[] = [];

    inst.on("beforesend", () => events.push("beforesend"));
    inst.on("delivered", () => events.push("delivered"));

    await inst.notify("Test").via("browser").send();
    expect(events).toEqual(["beforesend", "delivered"]);
  });

  it("browser auto-requests permission when status is default", async () => {
    MockNotif.permission = "default";
    const browser = new BrowserNotificationChannel();
    const requestSpy = vi.spyOn(browser, "requestPermission").mockResolvedValue("granted");
    const inst = createNotifications({ channels: { browser } });

    await inst.notify("Auto perm").via("browser").send();
    expect(requestSpy).toHaveBeenCalled();
  });
});

describe("Full-stack: createNotifications() with ToastChannel", () => {
  it("toast.success/error/warning/info all deliver", async () => {
    const toast = new ToastChannel();
    const inst = createNotifications({ channels: { toast } });

    await inst.toast.success("Saved");
    await inst.toast.error("Failed");
    await inst.toast.warning("Watch out");
    await inst.toast.info("FYI");

    expect(toast.headless.state.toasts).toHaveLength(4);
    const variants = toast.headless.state.toasts.map((t) => t.variant);
    expect(variants).toContain("success");
    expect(variants).toContain("error");
    expect(variants).toContain("warning");
    expect(variants).toContain("info");
  });

  it("toast deduplicates by notification id", async () => {
    const toast = new ToastChannel();
    const inst = createNotifications({ channels: { toast } });

    await inst.notify("First").id("fixed").via("toast").send();
    await inst.notify("Second").id("fixed").via("toast").send();

    expect(toast.headless.state.toasts).toHaveLength(1);
    expect(toast.headless.state.toasts[0]?.title).toBe("Second");
  });

  it("dismiss() removes toast after send", async () => {
    const toast = new ToastChannel();
    const inst = createNotifications({ channels: { toast } });

    await inst.notify("Remove me").id("rm").via("toast").send();
    toast.dismiss("rm");
    expect(toast.headless.state.toasts).toHaveLength(0);
  });
});

describe("Full-stack: middleware suppression", () => {
  it("suppressed notification is not delivered to any channel", async () => {
    const mock = new MockChannel("toast");
    const inst = createNotifications({ channels: { toast: mock } });

    inst.use(async (_ctx, _next) => {
      // suppress
    });

    const result = await inst.notify("Suppressed").via("toast").send();
    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("suppressed");
    expect(mock.sentNotifications).toHaveLength(0);
  });
});

describe("Full-stack: configurable fallback chain", () => {
  it("tries fallback when primary channel is unavailable", async () => {
    const unavailable = new MockChannel("browser", { available: false });
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { browser: unavailable, toast },
      fallback: ["toast"],
    });

    const result = await inst.notify("Fallback test").via("browser").send();
    expect(result.delivered).toContain("toast");
    expect(toast.headless.state.toasts).toHaveLength(1);
  });
});
