import type { NotificationsInstance } from "@palladium/notifications-core";
import { inject } from "vue";
import { NOTIFICATIONS_KEY } from "./plugin.js";

export function useNotifications(): NotificationsInstance {
  const instance = inject<NotificationsInstance>(NOTIFICATIONS_KEY);
  if (instance === undefined) {
    throw new TypeError(
      "useNotifications() must be called inside a component that has the NotificationsPlugin installed.",
    );
  }
  return instance;
}
