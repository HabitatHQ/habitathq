import type { NotificationsInstance } from "@palladium/notifications-core";
import type { App } from "vue";

export const NOTIFICATIONS_KEY: unique symbol = Symbol("palladium-notifications");

export interface NotificationsPluginOptions {
  instance: NotificationsInstance;
}

export const NotificationsPlugin = {
  install(app: App, options: NotificationsPluginOptions): void {
    app.provide(NOTIFICATIONS_KEY, options.instance);
  },
};
