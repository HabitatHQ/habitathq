import type {
  ChannelStatus,
  Notification,
  NotificationInteractionHandler,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { ExpoNotificationChannelOpts, ExpoNotificationSubscription } from "./types.js";

export class ExpoNotificationChannel implements NotificationsChannel {
  readonly name = "expo" as const;
  private readonly _opts: ExpoNotificationChannelOpts;
  private _permissionState: PermissionState = "default";
  private _interactionHandler: NotificationInteractionHandler | undefined;
  private readonly _notifications = new Map<string, Notification>();
  private readonly _responseListener: ExpoNotificationSubscription;

  constructor(opts: ExpoNotificationChannelOpts) {
    this._opts = opts;
    this._responseListener = opts.adapter.addNotificationResponseReceivedListener((response) => {
      const notification = this._notifications.get(response.notification.request.identifier ?? "");
      if (notification !== undefined) {
        this._interactionHandler?.clicked(notification, response.actionIdentifier);
      }
    });
  }

  setInteractionHandler(handler: NotificationInteractionHandler | undefined): void {
    this._interactionHandler = handler;
  }

  dispose(): void {
    this._responseListener.remove();
    this._interactionHandler = undefined;
    this._notifications.clear();
  }

  isAvailable(): boolean {
    return true;
  }

  permissionStatus(): PermissionState {
    return this._permissionState;
  }

  async requestPermission(): Promise<PermissionState> {
    const result = await this._opts.adapter.requestPermissionsAsync();
    const mapped: PermissionState =
      result.status === "granted" ? "granted" : result.status === "denied" ? "denied" : "default";
    this._permissionState = mapped;
    return mapped;
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    try {
      const data: Record<string, unknown> = {};
      if (notification.data !== undefined && typeof notification.data === "object") {
        Object.assign(data, notification.data);
      }
      if (notification.deepLink !== undefined) {
        data["deepLink"] = notification.deepLink;
      }

      const identifier = await this._opts.adapter.scheduleNotificationAsync({
        content: {
          title: notification.title,
          ...(notification.body !== undefined && { body: notification.body }),
          ...(Object.keys(data).length > 0 && { data }),
          ...(this._opts.defaultCategoryIdentifier !== undefined && {
            categoryIdentifier: this._opts.defaultCategoryIdentifier,
          }),
        },
        trigger: null,
      });
      this._notifications.set(identifier, notification);
      return { status: "delivered" };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
