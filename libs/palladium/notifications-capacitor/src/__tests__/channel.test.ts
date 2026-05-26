import { describe, expect, it, vi } from "vitest";
import { CapacitorNotificationChannel } from "../channel.js";
import type { CapacitorLocalNotifications } from "../types.js";

type MockLocal = CapacitorLocalNotifications & {
  scheduledNotifications: Array<{
    id: number;
    title: string;
    body?: string;
    extra?: Record<string, unknown>;
  }>;
};

function createMockLocal(): MockLocal {
  const scheduledNotifications: MockLocal["scheduledNotifications"] = [];
  return {
    scheduledNotifications,
    requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
    checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
    schedule: vi.fn().mockImplementation(async (opts) => {
      for (const n of opts.notifications) {
        scheduledNotifications.push(n);
      }
      return { notifications: opts.notifications.map((n: { id: number }) => ({ id: n.id })) };
    }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  };
}

describe("CapacitorNotificationChannel", () => {
  it("isAvailable() returns true with localNotifications configured", () => {
    const ch = new CapacitorNotificationChannel({ localNotifications: createMockLocal() });
    expect(ch.isAvailable()).toBe(true);
  });

  it("isAvailable() returns false with no adapters", () => {
    const ch = new CapacitorNotificationChannel({});
    expect(ch.isAvailable()).toBe(false);
  });

  it("requestPermission() maps 'granted' → 'granted'", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    expect(await ch.requestPermission()).toBe("granted");
  });

  it("requestPermission() maps 'denied' → 'denied'", async () => {
    const local = createMockLocal();
    (local.requestPermissions as ReturnType<typeof vi.fn>).mockResolvedValue({ display: "denied" });
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    expect(await ch.requestPermission()).toBe("denied");
  });

  it("requestPermission() maps 'prompt' → 'default'", async () => {
    const local = createMockLocal();
    (local.requestPermissions as ReturnType<typeof vi.fn>).mockResolvedValue({ display: "prompt" });
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    expect(await ch.requestPermission()).toBe("default");
  });

  it("send() schedules via localNotifications", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    await ch.send({ title: "Test notification" });
    expect(local.scheduledNotifications).toHaveLength(1);
  });

  it("send() returns delivered on success", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("delivered");
  });

  it("send() passes title correctly", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    await ch.send({ title: "My Title" });
    expect(local.scheduledNotifications[0]?.title).toBe("My Title");
  });

  it("send() passes body when present", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    await ch.send({ title: "Title", body: "Body text" });
    expect(local.scheduledNotifications[0]?.body).toBe("Body text");
  });

  it("send() includes deepLink in extra when present", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    await ch.send({ title: "T", deepLink: "/path/to/page" });
    expect(local.scheduledNotifications[0]?.extra?.["deepLink"]).toBe("/path/to/page");
  });

  it("send() returns skipped when no localNotifications", async () => {
    const ch = new CapacitorNotificationChannel({});
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("skipped");
  });

  it("send() returns failed when schedule throws", async () => {
    const local = createMockLocal();
    (local.schedule as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("schedule error"));
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    const result = await ch.send({ title: "Test" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toContain("schedule error");
    }
  });

  it("permissionStatus() returns 'default' initially", () => {
    const ch = new CapacitorNotificationChannel({ localNotifications: createMockLocal() });
    expect(ch.permissionStatus()).toBe("default");
  });

  it("permissionStatus() updates after requestPermission()", async () => {
    const local = createMockLocal();
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    await ch.requestPermission();
    expect(ch.permissionStatus()).toBe("granted");
  });

  it("name is 'capacitor'", () => {
    const ch = new CapacitorNotificationChannel({});
    expect(ch.name).toBe("capacitor");
  });
});
