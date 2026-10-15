import type { NotificationsInstance, PermissionState } from "@palladium/notifications-core";
import type { Readable } from "svelte/store";
import { writable } from "svelte/store";

export class NotificationsState {
  readonly #instance: NotificationsInstance;
  readonly #permWritable = writable<PermissionState>("not-applicable");
  readonly browserPermission: Readable<PermissionState> = this.#permWritable;
  readonly #unsubscribePermission: () => void;

  constructor(instance: NotificationsInstance) {
    this.#instance = instance;
    const ch = instance.getChannel("browser");
    if (ch !== undefined) {
      this.#permWritable.set(ch.permissionStatus());
    }
    this.#unsubscribePermission = instance.on("permissionchange", ({ channel, permission }) => {
      if (channel === "browser") this.#permWritable.set(permission);
    });
  }
  destroy(): void {
    this.#unsubscribePermission();
  }

  notify(title: string): ReturnType<NotificationsInstance["notify"]> {
    return this.#instance.notify(title);
  }

  get toast(): NotificationsInstance["toast"] {
    return this.#instance.toast;
  }

  get browser(): NotificationsInstance["browser"] {
    return this.#instance.browser;
  }
}
