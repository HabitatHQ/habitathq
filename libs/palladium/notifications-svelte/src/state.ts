import type { NotificationsInstance, PermissionState } from "@palladium/notifications-core";
import type { Readable } from "svelte/store";
import { writable } from "svelte/store";

export class NotificationsState {
  readonly #instance: NotificationsInstance;
  readonly #permWritable = writable<PermissionState>("not-applicable");
  readonly browserPermission: Readable<PermissionState> = this.#permWritable;

  constructor(instance: NotificationsInstance) {
    this.#instance = instance;
    const ch = instance.getChannel("browser");
    if (ch !== undefined) {
      this.#permWritable.set(ch.permissionStatus());
    }
    instance.on("delivered", () => {
      const channel = instance.getChannel("browser");
      if (channel !== undefined) {
        this.#permWritable.set(channel.permissionStatus());
      }
    });
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
