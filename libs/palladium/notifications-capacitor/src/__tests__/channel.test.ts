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

  it("schedules Android-compatible deterministic IDs and replaces pending logical notifications", async () => {
    const pending = new Map<number, { id: number; title: string }>();
    const local = createMockLocal();
    (local.schedule as ReturnType<typeof vi.fn>).mockImplementation(async (opts) => {
      for (const notification of opts.notifications) {
        if (
          !Number.isInteger(notification.id) ||
          notification.id < 1 ||
          notification.id > 0x7fffffff
        ) {
          throw new Error("IDENTIFIER_NOT_INT");
        }
        pending.set(notification.id, notification);
      }
      return {
        notifications: opts.notifications.map((notification: { id: number }) => ({
          id: notification.id,
        })),
      };
    });
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    const ids = new Map<string, number>();

    for (const logicalId of ["notification-1", "task-123", "high-hash-\uFFFF"]) {
      const first = await ch.send({ id: logicalId, title: "First" });
      expect(first.status).toBe("delivered");
      const scheduledId = [...pending.keys()].at(-1);
      if (scheduledId === undefined) throw new Error("Expected scheduled notification");
      expect(scheduledId).toBeGreaterThan(0);
      expect(scheduledId).toBeLessThanOrEqual(0x7fffffff);
      ids.set(logicalId, scheduledId);
      const pendingIds = [...pending.keys()];
      const replacement = await ch.send({ id: logicalId, title: "Replacement" });
      expect(replacement.status).toBe("delivered");
      expect([...pending.keys()]).toEqual(pendingIds);
      expect(pending.get(scheduledId)?.title).toBe("Replacement");
    }

    const reopened = new CapacitorNotificationChannel({ localNotifications: local });
    const pendingIds = [...pending.keys()];
    for (const logicalId of ["notification-1", "task-123", "high-hash-\uFFFF"]) {
      const scheduledId = ids.get(logicalId);
      if (scheduledId === undefined) throw new Error("Expected stable notification ID");
      const result = await reopened.send({ id: logicalId, title: "Repeated" });
      expect(result.status).toBe("delivered");
      expect([...pending.keys()]).toEqual(pendingIds);
      expect(pending.get(scheduledId)?.title).toBe("Repeated");
    }

    const zeroHashId = String.fromCharCode(59407, 65535, 65535, 54062);
    const zeroHashResult = await ch.send({ id: zeroHashId, title: "Zero hash" });
    expect(zeroHashResult.status).toBe("delivered");
    expect(pending.get(1)?.title).toBe("Zero hash");
    expect(new Set(ids.values()).size).toBe(ids.size);
  });

  it("reserves zero and gives generated notifications unique Android-compatible IDs", async () => {
    const pending = new Map<number, { id: number; title: string }>();
    const local = createMockLocal();
    (local.schedule as ReturnType<typeof vi.fn>).mockImplementation(async (opts) => {
      for (const notification of opts.notifications) {
        if (
          !Number.isInteger(notification.id) ||
          notification.id < 1 ||
          notification.id > 0x7fffffff
        ) {
          throw new Error("IDENTIFIER_NOT_INT");
        }
        pending.set(notification.id, notification);
      }
      return {
        notifications: opts.notifications.map((notification: { id: number }) => ({
          id: notification.id,
        })),
      };
    });
    const ch = new CapacitorNotificationChannel({ localNotifications: local });
    const generated = await Promise.all(
      Array.from({ length: 3 }, (_, index) => ch.send({ title: `Generated ${index}` })),
    );
    expect(generated.every((result) => result.status === "delivered")).toBe(true);
    expect(pending.size).toBe(3);
    expect(new Set(pending.keys()).size).toBe(3);
    expect([...pending.values()].map(({ title }) => title).sort()).toEqual([
      "Generated 0",
      "Generated 1",
      "Generated 2",
    ]);
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
