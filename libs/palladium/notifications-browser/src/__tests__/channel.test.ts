import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNotificationChannel } from "../channel.js";

interface MockNotificationInstance {
  title: string;
  opts: NotificationOptions;
  onclick: ((e: Event) => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const mockInstances: MockNotificationInstance[] = [];

class MockNotification {
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
    mockInstances.push(this);
  }
}

beforeEach(() => {
  mockInstances.length = 0;
  MockNotification.permission = "granted";
  MockNotification.requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("Notification", MockNotification);
  // Ensure window is defined
  if (typeof window === "undefined") {
    vi.stubGlobal("window", { focus: vi.fn(), location: { href: "" } });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserNotificationChannel", () => {
  it("isAvailable() returns true when Notification is in window", () => {
    const ch = new BrowserNotificationChannel();
    expect(ch.isAvailable()).toBe(true);
  });

  it("isAvailable() returns false when Notification is not in window", () => {
    vi.stubGlobal("Notification", undefined);
    const ch = new BrowserNotificationChannel();
    expect(ch.isAvailable()).toBe(false);
  });

  it("permissionStatus() maps 'granted' correctly", () => {
    MockNotification.permission = "granted";
    const ch = new BrowserNotificationChannel();
    expect(ch.permissionStatus()).toBe("granted");
  });

  it("permissionStatus() maps 'denied' correctly", () => {
    MockNotification.permission = "denied";
    const ch = new BrowserNotificationChannel();
    expect(ch.permissionStatus()).toBe("denied");
  });

  it("permissionStatus() maps 'default' correctly", () => {
    MockNotification.permission = "default";
    const ch = new BrowserNotificationChannel();
    expect(ch.permissionStatus()).toBe("default");
  });

  it("permissionStatus() returns 'not-applicable' when unavailable", () => {
    vi.stubGlobal("Notification", undefined);
    const ch = new BrowserNotificationChannel();
    expect(ch.permissionStatus()).toBe("not-applicable");
  });

  it("requestPermission() calls Notification.requestPermission()", async () => {
    const ch = new BrowserNotificationChannel();
    const result = await ch.requestPermission();
    expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    expect(result).toBe("granted");
  });

  it("requestPermission() returns 'not-applicable' when unavailable", async () => {
    vi.stubGlobal("Notification", undefined);
    const ch = new BrowserNotificationChannel();
    expect(await ch.requestPermission()).toBe("not-applicable");
  });

  it("send() creates a Notification with correct title", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "Hello World" });
    expect(mockInstances[0]?.title).toBe("Hello World");
  });

  it("send() passes body to Notification opts", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "T", body: "The body" });
    expect(mockInstances[0]?.opts.body).toBe("The body");
  });

  it("send() passes notification.icon when no opts.icon", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "T", icon: "/n-icon.png" });
    expect(mockInstances[0]?.opts.icon).toBe("/n-icon.png");
  });

  it("send() prefers opts.icon over notification.icon", async () => {
    const ch = new BrowserNotificationChannel({ icon: "/opts-icon.png" });
    await ch.send({ title: "T", icon: "/n-icon.png" });
    expect(mockInstances[0]?.opts.icon).toBe("/opts-icon.png");
  });

  it("send() sets requireInteraction=true for urgency 'urgent'", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "Urgent!", urgency: "urgent" });
    expect(mockInstances[0]?.opts.requireInteraction).toBe(true);
  });

  it("send() sets requireInteraction=false by default", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "Normal" });
    expect(mockInstances[0]?.opts.requireInteraction).toBe(false);
  });

  it("send() sets tag to notification.id", async () => {
    const ch = new BrowserNotificationChannel();
    await ch.send({ title: "T", id: "notif-123" });
    expect(mockInstances[0]?.opts.tag).toBe("notif-123");
  });

  it("send() returns delivered", async () => {
    const ch = new BrowserNotificationChannel();
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("delivered");
  });

  it("send() returns skipped when unavailable", async () => {
    vi.stubGlobal("Notification", undefined);
    const ch = new BrowserNotificationChannel();
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
  });

  it("send() returns skipped when permission is 'denied'", async () => {
    MockNotification.permission = "denied";
    const ch = new BrowserNotificationChannel();
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
  });

  it("send() auto-dismisses after autoDismissMs", async () => {
    vi.useFakeTimers();
    const ch = new BrowserNotificationChannel({ autoDismissMs: 3000 });
    await ch.send({ title: "Auto" });
    const notif = mockInstances[0];
    expect(notif?.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(notif?.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("send() calls onNotificationClick callback when onclick fires", async () => {
    const onClickMock = vi.fn();
    const ch = new BrowserNotificationChannel({ onNotificationClick: onClickMock });
    await ch.send({ title: "Click me" });
    const notif = mockInstances[0];
    const fakeEvent = { preventDefault: vi.fn() } as unknown as Event;
    notif?.onclick?.(fakeEvent);
    expect(onClickMock).toHaveBeenCalledOnce();
  });

  it("send() calls onNotificationDismiss when onclose fires", async () => {
    const onDismissMock = vi.fn();
    const ch = new BrowserNotificationChannel({ onNotificationDismiss: onDismissMock });
    await ch.send({ title: "Dismiss me" });
    mockInstances[0]?.onclose?.();
    expect(onDismissMock).toHaveBeenCalledOnce();
  });

  it("send() catches constructor errors and returns failed status", async () => {
    const FailingNotification = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      constructor() {
        throw new Error("constructor failed");
      }
    };
    vi.stubGlobal("Notification", FailingNotification);
    const ch = new BrowserNotificationChannel();
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("failed");
  });

  it("name is 'browser'", () => {
    const ch = new BrowserNotificationChannel();
    expect(ch.name).toBe("browser");
  });
});
