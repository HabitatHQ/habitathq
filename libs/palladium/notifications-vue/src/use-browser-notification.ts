import type {
  Notification,
  NotificationResult,
  PermissionState,
} from "@palladium/notifications-core";
import type { Ref } from "vue";
import { ref } from "vue";
import { useNotifications } from "./use-notifications.js";

export interface UseBrowserNotificationReturn {
  permissionStatus: Ref<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  send(notification: Notification): Promise<NotificationResult>;
}

export function useBrowserNotification(): UseBrowserNotificationReturn {
  const instance = useNotifications();
  const ch = instance.getChannel("browser");
  const permissionStatus = ref<PermissionState>(ch?.permissionStatus() ?? "not-applicable");

  return {
    permissionStatus,
    requestPermission: async () => {
      const result = await instance.browser.requestPermission();
      permissionStatus.value = result;
      return result;
    },
    send: (notification) => instance.browser.send(notification),
  };
}
