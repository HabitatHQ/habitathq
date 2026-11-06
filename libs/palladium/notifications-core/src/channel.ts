import type { ChannelName, ChannelStatus, Notification, PermissionState } from "./types.js";

/** Receives deliberate user interactions; a close following a click is not a dismissal. */
export interface NotificationInteractionHandler {
  clicked(notification: Notification, actionId?: string): void;
  dismissed(notification: Notification): void;
}
export interface NotificationsChannel {
  readonly name: ChannelName;
  send(notification: Notification): Promise<ChannelStatus>;
  requestPermission(): Promise<PermissionState>;
  permissionStatus(): PermissionState;
  isAvailable(): boolean;
  setInteractionHandler?(handler: NotificationInteractionHandler | undefined): void;
  dispose?(): void | Promise<void>;
}
