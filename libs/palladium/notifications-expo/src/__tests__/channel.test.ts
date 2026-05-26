import { describe, expect, it, vi } from "vitest";
import { ExpoNotificationChannel } from "../channel.js";
import type { ExpoNotificationRequest, ExpoNotificationsAdapter } from "../types.js";

type MockAdapter = ExpoNotificationsAdapter & {
  scheduledNotifications: ExpoNotificationRequest[];
};

function createMockAdapter(): MockAdapter {
  const scheduledNotifications: ExpoNotificationRequest[] = [];
  return {
    scheduledNotifications,
    requestPermissionsAsync: vi.fn().mockResolvedValue({ status: "granted", canAskAgain: true }),
    getPermissionsAsync: vi.fn().mockResolvedValue({ status: "granted", canAskAgain: true }),
    scheduleNotificationAsync: vi.fn().mockImplementation(async (req: ExpoNotificationRequest) => {
      scheduledNotifications.push(req);
      return "notification-id-123";
    }),
    cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
    addNotificationReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    addNotificationResponseReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  };
}

describe("ExpoNotificationChannel", () => {
  it("isAvailable() returns true", () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    expect(ch.isAvailable()).toBe(true);
  });

  it("requestPermission() maps 'granted' → 'granted'", async () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    expect(await ch.requestPermission()).toBe("granted");
  });

  it("requestPermission() maps 'denied' → 'denied'", async () => {
    const adapter = createMockAdapter();
    (adapter.requestPermissionsAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });
    const ch = new ExpoNotificationChannel({ adapter });
    expect(await ch.requestPermission()).toBe("denied");
  });

  it("requestPermission() maps 'undetermined' → 'default'", async () => {
    const adapter = createMockAdapter();
    (adapter.requestPermissionsAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "undetermined",
      canAskAgain: true,
    });
    const ch = new ExpoNotificationChannel({ adapter });
    expect(await ch.requestPermission()).toBe("default");
  });

  it("send() calls scheduleNotificationAsync with title", async () => {
    const adapter = createMockAdapter();
    const ch = new ExpoNotificationChannel({ adapter });
    await ch.send({ title: "My Push" });
    expect(adapter.scheduledNotifications).toHaveLength(1);
    expect(adapter.scheduledNotifications[0]?.content.title).toBe("My Push");
  });

  it("send() passes body when present", async () => {
    const adapter = createMockAdapter();
    const ch = new ExpoNotificationChannel({ adapter });
    await ch.send({ title: "T", body: "Hello body" });
    expect(adapter.scheduledNotifications[0]?.content.body).toBe("Hello body");
  });

  it("send() returns delivered on success", async () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("delivered");
  });

  it("send() includes deepLink in data when present", async () => {
    const adapter = createMockAdapter();
    const ch = new ExpoNotificationChannel({ adapter });
    await ch.send({ title: "T", deepLink: "/home" });
    expect(adapter.scheduledNotifications[0]?.content.data?.["deepLink"]).toBe("/home");
  });

  it("send() returns failed when adapter throws", async () => {
    const adapter = createMockAdapter();
    (adapter.scheduleNotificationAsync as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("adapter error"),
    );
    const ch = new ExpoNotificationChannel({ adapter });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toContain("adapter error");
    }
  });

  it("permissionStatus() returns 'default' initially", () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    expect(ch.permissionStatus()).toBe("default");
  });

  it("permissionStatus() updates after requestPermission()", async () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    await ch.requestPermission();
    expect(ch.permissionStatus()).toBe("granted");
  });

  it("send() trigger is null (immediate)", async () => {
    const adapter = createMockAdapter();
    const ch = new ExpoNotificationChannel({ adapter });
    await ch.send({ title: "T" });
    expect(adapter.scheduledNotifications[0]?.trigger).toBeNull();
  });

  it("name is 'expo'", () => {
    const ch = new ExpoNotificationChannel({ adapter: createMockAdapter() });
    expect(ch.name).toBe("expo");
  });
});
