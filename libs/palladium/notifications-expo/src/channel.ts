import type {
  ChannelStatus,
  Notification,
  NotificationInteractionHandler,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { ExpoNotificationChannelOpts, ExpoNotificationSubscription } from "./types.js";

const notificationMetadataKey = "__palladium_notification";

function parseNotificationMetadata(data: unknown): Notification | undefined {
  if (typeof data !== "object" || data === null || !(notificationMetadataKey in data)) return;
  const serialized = data[notificationMetadataKey];
  if (typeof serialized !== "string") return;
  try {
    const notification: unknown = JSON.parse(serialized);
    if (
      typeof notification === "object" &&
      notification !== null &&
      "title" in notification &&
      typeof notification.title === "string"
    ) {
      return notification as Notification;
    }
  } catch {
    return;
  }
  return undefined;
}

export class ExpoNotificationChannel implements NotificationsChannel {
  readonly name = "expo" as const;
  private readonly _opts: ExpoNotificationChannelOpts;
  private _permissionState: PermissionState = "default";
  private _interactionHandler: NotificationInteractionHandler | undefined;
  private _responseListener: ExpoNotificationSubscription | undefined;
  private _disposed = false;
  private _listenerRemoved = false;

  constructor(opts: ExpoNotificationChannelOpts) {
    this._opts = opts;
    this._attachResponseListener();
  }

  setInteractionHandler(handler: NotificationInteractionHandler | undefined): void {
    this._interactionHandler = handler;
    if (handler === undefined || !this._disposed) return;
    this._disposed = false;
    if (this._listenerRemoved) {
      this._listenerRemoved = false;
      this._attachResponseListener();
    }
  }

  private _attachResponseListener(): void {
    this._responseListener = this._opts.adapter.addNotificationResponseReceivedListener(
      (response) => {
        const notification = parseNotificationMetadata(response.notification.request.content.data);
        if (notification !== undefined) {
          this._interactionHandler?.clicked(notification, response.actionIdentifier);
        }
      },
    );
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this._interactionHandler = undefined;
    if (this._listenerRemoved) return;
    this._responseListener?.remove();
    this._listenerRemoved = true;
  }

  isAvailable(): boolean {
    return !this._disposed;
  }

  permissionStatus(): PermissionState {
    return this._permissionState;
  }

  async requestPermission(): Promise<PermissionState> {
    if (this._disposed) return "not-applicable";
    const result = await this._opts.adapter.requestPermissionsAsync();
    const mapped: PermissionState =
      result.status === "granted" ? "granted" : result.status === "denied" ? "denied" : "default";
    this._permissionState = mapped;
    return mapped;
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    if (this._disposed) return { status: "skipped", reason: "Notification channel is disposed" };
    try {
      const data: Record<string, unknown> = {};
      if (notification.data !== undefined && typeof notification.data === "object") {
        Object.assign(data, notification.data);
      }
      if (notification.deepLink !== undefined) data["deepLink"] = notification.deepLink;
      data[notificationMetadataKey] = JSON.stringify(notification);
      await this._opts.adapter.scheduleNotificationAsync({
        content: {
          title: notification.title,
          ...(notification.body !== undefined && { body: notification.body }),
          data,
          ...(this._opts.defaultCategoryIdentifier !== undefined && {
            categoryIdentifier: this._opts.defaultCategoryIdentifier,
          }),
        },
        trigger: null,
      });
      if (this._disposed) return { status: "skipped", reason: "Notification channel is disposed" };
      return { status: "delivered" };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
