import { createNotifications, MockChannel, type Notification } from "@palladium/notifications-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushChannel } from "../channel.js";

const mockPushSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
  getKey: vi.fn((name: string) =>
    name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5, 6]).buffer,
  ),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

const expectedSubscription = {
  endpoint: mockPushSubscription.endpoint,
  keys: { p256dh: "AQID", auth: "BAUG" },
};

const mockPushManager = {
  subscribe: vi.fn().mockResolvedValue(mockPushSubscription),
  getSubscription: vi.fn().mockResolvedValue(mockPushSubscription),
};

const mockRegistration = {
  scope: "https://example.test/",
  pushManager: mockPushManager,
};

const mockServiceWorker = {
  register: vi.fn().mockResolvedValue(mockRegistration),
  getRegistration: vi.fn().mockResolvedValue(mockRegistration),
  ready: Promise.resolve(mockRegistration),
};

class MockNotificationStatic {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi
    .fn<[], Promise<NotificationPermission>>()
    .mockResolvedValue("granted");
}

beforeEach(() => {
  vi.clearAllMocks();
  MockNotificationStatic.permission = "granted";
  mockRegistration.scope = new URL("/", window.location.href).href;
  vi.stubGlobal("Notification", MockNotificationStatic);
  vi.stubGlobal("navigator", { serviceWorker: mockServiceWorker });
  vi.stubGlobal("PushManager", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  vi.stubGlobal("btoa", (s: string) => Buffer.from(s, "binary").toString("base64"));
  // Ensure window is defined with PushManager
  if (typeof window === "undefined") {
    vi.stubGlobal("window", { PushManager: {} });
  }
  mockPushManager.subscribe.mockResolvedValue(mockPushSubscription);
  mockPushSubscription.unsubscribe.mockResolvedValue(true);
  mockPushManager.getSubscription.mockResolvedValue(mockPushSubscription);
  mockServiceWorker.getRegistration.mockResolvedValue(mockRegistration);
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

  it("subscribe() caches the browser subscription without a registration endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No backend configured")));
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });

    expect(await ch.subscribe()).toEqual(expectedSubscription);
    expect(ch.getSubscription()).toEqual(expectedSubscription);
    expect(await ch.send({ title: "Push message" })).toMatchObject({ status: "skipped" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([200, 201, 204])(
    "subscribe() caches endpoint and keys after backend registration HTTP %i",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        subscribeEndpoint: "/api/push/subscribe",
      });

      expect(await ch.subscribe()).toEqual(expectedSubscription);
      expect(ch.getSubscription()).toEqual(expectedSubscription);
    },
  );

  it.each([400, 401, 500])(
    "subscribe() leaves the channel unsubscribed after backend registration HTTP %i",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        subscribeEndpoint: "/api/push/subscribe",
      });

      expect(await ch.subscribe()).toBeNull();
      expect(ch.getSubscription()).toBeNull();
      expect(await ch.send({ title: "Push message" })).toEqual({
        status: "skipped",
        reason: "Not subscribed to web push",
      });
    },
  );

  it("subscribe() leaves the channel unsubscribed after a registration network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const ch = new WebPushChannel({
      vapidPublicKey: "dGVzdA==",
      subscribeEndpoint: "/api/push/subscribe",
    });

    expect(await ch.subscribe()).toBeNull();
    expect(ch.getSubscription()).toBeNull();
    expect(await ch.send({ title: "Push message" })).toEqual({
      status: "skipped",
      reason: "Not subscribed to web push",
    });
  });

  it.each([400, 401, 500, "network"] as const)(
    "subscribe() preserves the registered subscription after a later %s failure",
    async (failure) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        subscribeEndpoint: "/api/push/subscribe",
        sendEndpoint: "/api/push/send",
      });
      expect(await ch.subscribe()).toEqual(expectedSubscription);

      mockPushManager.subscribe.mockResolvedValueOnce({
        ...mockPushSubscription,
        endpoint: "https://push.example.test/replacement",
        getKey: vi.fn(() => new Uint8Array([7, 8, 9]).buffer),
      });
      if (failure === "network") {
        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      } else {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: failure }));
      }

      expect(await ch.subscribe()).toBeNull();
      expect(ch.getSubscription()).toEqual(expectedSubscription);
      expect(await ch.send({ title: "Push message" })).toEqual({ status: "delivered" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/push/send",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: expectedSubscription,
            notification: { title: "Push message" },
          }),
        }),
      );
    },
  );

  it("unsubscribe() discovers and cancels a persisted subscription on a fresh channel", async () => {
    let browserSubscriptionPresent = true;
    const unsubscribeMock = vi.fn(async () => {
      browserSubscriptionPresent = false;
      return true;
    });
    const persistedSubscription = {
      endpoint: expectedSubscription.endpoint,
      getKey: vi.fn((name: string) =>
        name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5, 6]).buffer,
      ),
      unsubscribe: unsubscribeMock,
    };
    mockPushManager.getSubscription.mockImplementation(async () =>
      browserSubscriptionPresent ? persistedSubscription : null,
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const ch = new WebPushChannel({
      vapidPublicKey: "dGVzdA==",
      unsubscribeEndpoint: "/api/push/unsubscribe",
    });

    await expect(ch.unsubscribe()).resolves.toBeUndefined();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
    expect(browserSubscriptionPresent).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/unsubscribe",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify(expectedSubscription),
      }),
    );
    expect(ch.getSubscription()).toBeNull();
    await ch.unsubscribe();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("unsubscribe() uses only an exact custom-scope registration, not a covering root registration", async () => {
    const scopedUnsubscribe = vi.fn().mockResolvedValue(true);
    const scopedManager = {
      getSubscription: vi.fn().mockResolvedValue({
        ...mockPushSubscription,
        unsubscribe: scopedUnsubscribe,
      }),
    };
    const unrelatedUnsubscribe = vi.fn().mockResolvedValue(true);
    const unrelatedManager = {
      getSubscription: vi.fn().mockResolvedValue({
        ...mockPushSubscription,
        endpoint: "https://push.example.test/unrelated",
        unsubscribe: unrelatedUnsubscribe,
      }),
    };
    const scopedRegistration = {
      scope: new URL("/app/", window.location.href).href,
      pushManager: scopedManager,
    };
    mockServiceWorker.getRegistration.mockResolvedValueOnce(scopedRegistration);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ...mockServiceWorker,
        ready: Promise.resolve({
          scope: new URL("/", window.location.href).href,
          pushManager: unrelatedManager,
        }),
      },
    });
    const ch = new WebPushChannel({
      vapidPublicKey: "test",
      serviceWorkerScope: "/app/",
    });
    await ch.unsubscribe();

    expect(scopedUnsubscribe).toHaveBeenCalledOnce();
    expect(unrelatedUnsubscribe).not.toHaveBeenCalled();
  });

  it("unsubscribe() does nothing when no registration exists", async () => {
    mockServiceWorker.getRegistration.mockResolvedValue(undefined);
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    await expect(ch.unsubscribe()).resolves.toBeUndefined();
    await expect(ch.unsubscribe()).resolves.toBeUndefined();
    expect(mockPushManager.getSubscription).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["false", false],
    ["error", new Error("browser unsubscribe failed")],
  ] as const)(
    "unsubscribe() rejects and retains retryable state when browser removal returns %s",
    async (_, result) => {
      const unsubscribeMock =
        result === false ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(result);
      mockPushManager.getSubscription.mockResolvedValueOnce({
        endpoint: expectedSubscription.endpoint,
        getKey: vi.fn((name: string) =>
          name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5, 6]).buffer,
        ),
        unsubscribe: unsubscribeMock,
      });
      const ch = new WebPushChannel({ vapidPublicKey: "test" });
      await expect(ch.unsubscribe()).rejects.toBeTruthy();
      expect(ch.getSubscription()).toEqual(expectedSubscription);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([500, "network"] as const)(
    "unsubscribe() retains endpoint and keys after backend %s failure and retries without browser removal",
    async (failure) => {
      let backendRegistered = true;
      let deleteAttempts = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as typeof expectedSubscription;
        expect(payload).toEqual(expectedSubscription);
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          if (failure === "network") throw new TypeError("Failed to fetch");
          return new Response(null, { status: failure });
        }
        backendRegistered = false;
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal("fetch", fetchMock);
      let browserSubscriptionPresent = true;
      const unsubscribeMock = vi.fn(async () => {
        browserSubscriptionPresent = false;
        return true;
      });
      const browserSubscription = {
        endpoint: expectedSubscription.endpoint,
        getKey: vi.fn((name: string) =>
          name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5, 6]).buffer,
        ),
        unsubscribe: unsubscribeMock,
      };
      mockPushManager.getSubscription.mockImplementation(async () =>
        browserSubscriptionPresent ? browserSubscription : null,
      );
      const ch = new WebPushChannel({
        vapidPublicKey: "test",
        unsubscribeEndpoint: "/api/push/unsubscribe",
        sendEndpoint: "/api/push/send",
      });
      await expect(ch.unsubscribe()).rejects.toBeTruthy();
      expect(unsubscribeMock).toHaveBeenCalledOnce();
      expect(browserSubscriptionPresent).toBe(false);
      expect(ch.getSubscription()).toEqual(expectedSubscription);
      expect(backendRegistered).toBe(true);
      expect(await ch.send({ title: "Must not use the unsubscribe retry payload" })).toMatchObject({
        status: "skipped",
      });
      expect(fetchMock).toHaveBeenCalledOnce();

      await expect(ch.unsubscribe()).resolves.toBeUndefined();
      expect(unsubscribeMock).toHaveBeenCalledOnce();
      expect(mockPushManager.getSubscription).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/push/unsubscribe",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify(expectedSubscription),
        }),
      );
      expect(backendRegistered).toBe(false);
      expect(ch.getSubscription()).toBeNull();
    },
  );

  it("unsubscribe() is a no-op when there is no subscription or cached payload", async () => {
    mockServiceWorker.getRegistration.mockResolvedValue(undefined);
    const ch = new WebPushChannel({ vapidPublicKey: "test" });
    await ch.unsubscribe();
    await ch.unsubscribe();
    expect(fetch).not.toHaveBeenCalled();
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

  it.each([200, 201, 204])(
    "send() POSTs the complete subscription and notification before reporting HTTP %i acceptance",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        sendEndpoint: "/api/push/send",
      });
      await ch.subscribe();
      const notification: Notification = {
        id: "message-1",
        title: "Push message",
        body: "Message body",
        icon: "/icon.png",
        badge: "/badge.png",
        image: "/image.png",
        urgency: "high",
        data: { taskId: 42, nested: { enabled: true } },
        actions: [{ id: "open", label: "Open", icon: "/open.png" }],
        deepLink: "/tasks/42",
      };

      expect(await ch.send(notification)).toEqual({ status: "delivered" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: expectedSubscription, notification }),
      });
    },
  );

  it("send() skips a subscribed channel without a send endpoint", async () => {
    const ch = new WebPushChannel({ vapidPublicKey: "dGVzdA==" });
    await ch.subscribe();

    expect(await ch.send({ title: "Push message" })).toMatchObject({
      status: "skipped",
      reason: expect.stringMatching(/endpoint/i),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([302, 400, 401, 500])(
    "send() returns a failed Error when the backend responds HTTP %i",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        sendEndpoint: "/api/push/send",
      });
      await ch.subscribe();

      const result = await ch.send({ title: "Push message" });
      expect(result).toMatchObject({ status: "failed", error: expect.any(Error) });
      if (result.status === "failed") expect(result.error.message).toContain(String(status));
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([new TypeError("Failed to fetch"), "Network unavailable"])(
    "send() normalizes network rejection %s to a failed Error",
    async (error) => {
      const fetchMock = vi.fn().mockRejectedValue(error);
      vi.stubGlobal("fetch", fetchMock);
      const ch = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        sendEndpoint: "/api/push/send",
      });
      await ch.subscribe();

      const result = await ch.send({ title: "Push message" });
      expect(result).toMatchObject({ status: "failed", error: expect.any(Error) });
      if (result.status === "failed") {
        if (error instanceof Error) expect(result.error).toBe(error);
        else expect(result.error.message).toBe(error);
      }
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each(["missing endpoint", "HTTP failure", "network failure"] as const)(
    "send() permits notifications-core fallback after %s",
    async (failure) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
      if (failure === "network failure") {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      }
      vi.stubGlobal("fetch", fetchMock);
      const webPush = new WebPushChannel({
        vapidPublicKey: "dGVzdA==",
        ...(failure !== "missing endpoint" && { sendEndpoint: "/api/push/send" }),
      });
      await webPush.subscribe();
      const toast = new MockChannel("toast");
      const notifications = createNotifications({
        channels: { webPush, toast },
        fallback: ["toast"],
      });

      const result = await notifications.notify("Fallback message").via("webPush").send();
      expect(result.delivered).toEqual(["toast"]);
      expect(toast.sentNotifications).toEqual([{ title: "Fallback message" }]);
      if (failure === "missing endpoint") {
        expect(result.skipped).toEqual([
          { channel: "webPush", reason: expect.stringMatching(/endpoint/i) },
        ]);
        expect(result.failed).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
      } else {
        expect(result.failed).toEqual([{ channel: "webPush", error: expect.any(Error) }]);
        expect(result.skipped).toEqual([]);
        expect(fetchMock).toHaveBeenCalledOnce();
      }
    },
  );

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
