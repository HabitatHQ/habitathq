import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushChannel } from "../channel.js";

const mockPushSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
  getKey: vi.fn((name: string) =>
    name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5, 6]).buffer,
  ),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

const mockPushManager = {
  subscribe: vi.fn().mockResolvedValue(mockPushSubscription),
  getSubscription: vi.fn().mockResolvedValue(mockPushSubscription),
};

const mockRegistration = {
  pushManager: mockPushManager,
};

const mockServiceWorker = {
  register: vi.fn().mockResolvedValue(mockRegistration),
  ready: Promise.resolve(mockRegistration),
};

class MockNotificationStatic {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi
    .fn<[], Promise<NotificationPermission>>()
    .mockResolvedValue("granted");
}

beforeEach(() => {
  MockNotificationStatic.permission = "granted";
  vi.stubGlobal("Notification", MockNotificationStatic);
  vi.stubGlobal("navigator", { serviceWorker: mockServiceWorker });
  vi.stubGlobal("PushManager", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("btoa", (s: string) => Buffer.from(s, "binary").toString("base64"));
  // Ensure window is defined with PushManager
  if (typeof window === "undefined") {
    vi.stubGlobal("window", { PushManager: {} });
  }
  mockPushManager.subscribe.mockResolvedValue(mockPushSubscription);
  mockPushSubscription.unsubscribe.mockResolvedValue(true);
  mockPushManager.getSubscription.mockResolvedValue(mockPushSubscription);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebPushChannel", () => {
  it("isAvailable() returns true when APIs present", () => {
    const ch = new WebPushChannel({ vapidPublicKey: "test-key" });
    expect(ch.isAvailable()).toBe(true);
  });

  it("isAvailable() returns false when serviceWorker not in navigator", () => {
    vi.stubGlobal("navigator", {});
    const ch = new WebPushChannel({ vapidPublicKey: "test-key" });
    expect(ch.isAvailable()).toBe(false);
  });

  it("permissionStatus() maps granted correctly", () => {
    MockNotificationStatic.permission = "granted";
    const ch = new WebPushChannel({ vapidPublicKey: "test-key" });
    expect(ch.permissionStatus()).toBe("granted");
  });

  it("permissionStatus() maps denied correctly", () => {
    MockNotificationStatic.permission = "denied";
    const ch = new WebPushChannel({ vapidPublicKey: "test-key" });
    expect(ch.permissionStatus()).toBe("denied");
  });

  it("subscribe() registers service worker", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    expect(mockServiceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("subscribe() returns PushSubscriptionJSON", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    const result = await ch.subscribe();
    expect(result).not.toBeNull();
    expect(typeof result?.endpoint).toBe("string");
    expect(typeof result?.keys.p256dh).toBe("string");
    expect(typeof result?.keys.auth).toBe("string");
  });

  it("subscribe() POSTs to subscribeEndpoint when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const ch = new WebPushChannel({
      vapidPublicKey: "dGVzdA==",
      subscribeEndpoint: "/api/push/subscribe",
    });
    await ch.subscribe();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("subscribe() does not POST when no subscribeEndpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unsubscribe() calls sub.unsubscribe()", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    await ch.unsubscribe();
    expect(mockPushSubscription.unsubscribe).toHaveBeenCalled();
  });

  it("unsubscribe() DELETEs to unsubscribeEndpoint when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const ch = new WebPushChannel({
      vapidPublicKey: "dGVzdA==",
      unsubscribeEndpoint: "/api/push/unsubscribe",
    });
    await ch.subscribe();
    await ch.unsubscribe();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/unsubscribe",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("getSubscription() returns null initially", () => {
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    expect(ch.getSubscription()).toBeNull();
  });

  it("getSubscription() returns subscription after subscribe()", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    expect(ch.getSubscription()).not.toBeNull();
  });

  it("send() returns delivered when subscribed and granted", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    const result = await ch.send({ title: "Push message" });
    expect(result.status).toBe("delivered");
  });

  it("send() returns skipped when not subscribed", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("Not subscribed");
    }
  });

  it("send() returns skipped when not available", async () => {
    vi.stubGlobal("navigator", {});
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
  });

  it("send() returns skipped when permission denied", async () => {
    MockNotificationStatic.permission = "denied";
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
  });

  it("name is 'webPush'", () => {
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    expect(ch.name).toBe("webPush");
  });
});
