import { createNotifications, MockChannel } from "@palladium/notifications-core";
import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { NotificationsState } from "../state.js";
import { createNotificationsStore } from "../stores.js";

describe("permission event consumers", () => {
  it.each(["granted", "denied"] as const)(
    "updates live stores after %s request",
    async (decision) => {
      const channel = new MockChannel("browser", { permissionState: "default" });
      vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
        channel.setPermissionState(decision);
        return decision;
      });
      const instance = createNotifications({ channels: { browser: channel } });
      const first = createNotificationsStore(instance);
      const second = createNotificationsStore(instance);
      const state = new NotificationsState(instance);
      const firstValues: string[] = [];
      const secondValues: string[] = [];
      const unsubscribeFirst = first.browserPermission.subscribe((permission) =>
        firstValues.push(permission),
      );
      const unsubscribeSecond = second.browserPermission.subscribe((permission) =>
        secondValues.push(permission),
      );
      expect(get(first.browserPermission)).toBe("default");
      expect(get(second.browserPermission)).toBe("default");
      await instance.browser.requestPermission();
      expect(get(first.browserPermission)).toBe(decision);
      expect(get(second.browserPermission)).toBe(decision);
      expect(get(state.browserPermission)).toBe(decision);
      expect(channel.sentNotifications).toEqual([]);
      expect(firstValues).toEqual(["default", decision]);
      expect(secondValues).toEqual(["default", decision]);
      unsubscribeFirst();
      unsubscribeSecond();
      state.destroy();
      first.destroy();
      second.destroy();
    },
  );

  it("rejects a failed request without publishing a false permission transition", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    const error = new Error("request failed");
    vi.spyOn(channel, "requestPermission").mockRejectedValue(error);
    const instance = createNotifications({ channels: { browser: channel } });
    const store = createNotificationsStore(instance);
    await expect(instance.browser.requestPermission()).rejects.toBe(error);
    expect(get(store.browserPermission)).toBe("default");
    store.destroy();
  });
  it("stops updating destroyed stores and state while keeping other listeners live", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    let decision: "granted" | "denied" = "granted";
    vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
      channel.setPermissionState(decision);
      return decision;
    });
    const instance = createNotifications({ channels: { browser: channel } });
    const removed = createNotificationsStore(instance);
    const remaining = createNotificationsStore(instance);
    const state = new NotificationsState(instance);
    await instance.browser.requestPermission();
    removed.destroy();
    state.destroy();
    decision = "denied";
    await remaining.browser.requestPermission();
    expect(get(removed.browserPermission)).toBe("granted");
    expect(get(state.browserPermission)).toBe("granted");
    expect(get(remaining.browserPermission)).toBe("denied");
    remaining.destroy();
  });
});
