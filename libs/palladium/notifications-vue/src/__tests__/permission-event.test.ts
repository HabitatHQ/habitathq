import {
  createNotifications,
  MockChannel,
  type PermissionState,
} from "@palladium/notifications-core";
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type Ref } from "vue";
import { NotificationsPlugin } from "../plugin.js";
import { useBrowserNotification } from "../use-browser-notification.js";

describe("browser notification permission events", () => {
  it.each(["granted", "denied"] as const)(
    "updates reactive permission after %s request",
    async (decision) => {
      const channel = new MockChannel("browser", { permissionState: "default" });
      vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
        channel.setPermissionState(decision);
        return decision;
      });
      const instance = createNotifications({ channels: { browser: channel } });
      let permission: Ref<PermissionState> | undefined;
      let otherPermission: Ref<PermissionState> | undefined;
      let request!: () => Promise<PermissionState>;
      const app = createApp(
        defineComponent({
          setup() {
            const notifications = useBrowserNotification();
            permission = notifications.permissionStatus;
            otherPermission = useBrowserNotification().permissionStatus;
            request = notifications.requestPermission;
            return () => h("div", notifications.permissionStatus.value);
          },
        }),
      );
      app.use(NotificationsPlugin, { instance });
      const root = document.createElement("div");
      app.mount(root);
      expect(permission?.value).toBe("default");
      await request();
      await nextTick();
      expect(permission?.value).toBe(decision);
      expect(otherPermission?.value).toBe(decision);
      expect(channel.sentNotifications).toEqual([]);
      app.unmount();
    },
  );

  it("propagates a rejected request without changing permission", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    const failure = new Error("request failed");
    vi.spyOn(channel, "requestPermission").mockRejectedValue(failure);
    const instance = createNotifications({ channels: { browser: channel } });
    let permission: Ref<PermissionState> | undefined;
    let request!: () => Promise<PermissionState>;
    const app = createApp(
      defineComponent({
        setup() {
          const notifications = useBrowserNotification();
          permission = notifications.permissionStatus;
          request = notifications.requestPermission;
          return () => h("div");
        },
      }),
    );
    app.use(NotificationsPlugin, { instance });
    app.mount(document.createElement("div"));
    await expect(request()).rejects.toBe(failure);
    expect(permission?.value).toBe("default");
    app.unmount();
  });
  it("updates Vue permission when another instance consumer requests", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
      channel.setPermissionState("granted");
      return "granted";
    });
    const instance = createNotifications({ channels: { browser: channel } });
    let permission: Ref<PermissionState> | undefined;
    const app = createApp(
      defineComponent({
        setup() {
          const notifications = useBrowserNotification();
          permission = notifications.permissionStatus;
          return () => h("div", notifications.permissionStatus.value);
        },
      }),
    );
    app.use(NotificationsPlugin, { instance });
    app.mount(document.createElement("div"));
    await instance.browser.requestPermission();
    await nextTick();
    expect(permission?.value).toBe("granted");
    app.unmount();
  });
  it("does not update a disposed Vue permission ref after a pending request completes", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    const pending = Promise.withResolvers<PermissionState>();
    vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
      const decision = await pending.promise;
      channel.setPermissionState(decision);
      return decision;
    });
    const instance = createNotifications({ channels: { browser: channel } });
    let permission: Ref<PermissionState> | undefined;
    const app = createApp(
      defineComponent({
        setup() {
          permission = useBrowserNotification().permissionStatus;
          return () => h("div");
        },
      }),
    );
    app.use(NotificationsPlugin, { instance });
    app.mount(document.createElement("div"));
    const requested = instance.browser.requestPermission();
    app.unmount();
    pending.resolve("denied");
    await requested;
    expect(permission?.value).toBe("default");
  });
});
