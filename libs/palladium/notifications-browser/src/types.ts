import type { Notification } from "@palladium/notifications-core";

export interface BrowserNotificationChannelOpts {
  icon?: string;
  badge?: string;
  autoDismissMs?: number;
  requireInteraction?: boolean;
  onNotificationClick?: (notification: Notification) => void;
  onNotificationDismiss?: (notification: Notification) => void;
}
