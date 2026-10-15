import type {
  Notification,
  NotificationResult,
  PermissionState,
} from "@palladium/notifications-core";
import type { Ref } from "vue";
import { onScopeDispose, ref } from "vue";
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
  const unsubscribe = instance.on("permissionchange", ({ channel, permission }) => {
    if (channel === "browser") permissionStatus.value = permission;
  });
  onScopeDispose(unsubscribe);

  return {
    permissionStatus,
    requestPermission: () => instance.requestPermission("browser"),
    send: (notification) => instance.browser.send(notification),
  };
}
