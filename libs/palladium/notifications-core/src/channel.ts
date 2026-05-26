import type { ChannelName, ChannelStatus, Notification, PermissionState } from "./types.js";

export interface NotificationsChannel {
  readonly name: ChannelName;
  send(notification: Notification): Promise<ChannelStatus>;
  requestPermission(): Promise<PermissionState>;
  permissionStatus(): PermissionState;
  isAvailable(): boolean;
}
