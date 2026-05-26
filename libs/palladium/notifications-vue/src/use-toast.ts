import type { NotificationsInstance } from "@palladium/notifications-core";
import { useNotifications } from "./use-notifications.js";

export function useToast(): NotificationsInstance["toast"] {
  const instance = useNotifications();
  return instance.toast;
}
