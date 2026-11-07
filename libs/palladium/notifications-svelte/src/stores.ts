import type { NotificationsInstance, PermissionState } from "@palladium/notifications-core";
import type { Readable } from "svelte/store";
import { writable } from "svelte/store";

export interface NotificationsStoreResult {
  browserPermission: Readable<PermissionState>;
  notify: NotificationsInstance["notify"];
  toast: NotificationsInstance["toast"];
  on: NotificationsInstance["on"];
  browser: NotificationsInstance["browser"];
  destroy(): void;
}

export function createNotificationsStore(
  instance: NotificationsInstance,
): NotificationsStoreResult {
  const initial: PermissionState =
    instance.getChannel("browser")?.permissionStatus() ?? "not-applicable";
  const _browserPermission = writable<PermissionState>(initial);

  const unsub = instance.on("permissionchange", ({ channel, permission }) => {
    if (channel === "browser") _browserPermission.set(permission);
  });

  return {
    browserPermission: _browserPermission,
    notify: (title) => instance.notify(title),
    toast: instance.toast,
    on: (event, handler) => instance.on(event, handler),
    browser: instance.browser,
    destroy(): void {
      unsub();
    },
  };
}

export function createNotify(instance: NotificationsInstance): NotificationsInstance["notify"] {
  return (title) => instance.notify(title);
}
