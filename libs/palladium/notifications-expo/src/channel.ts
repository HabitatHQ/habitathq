import type {
  ChannelStatus,
  Notification,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { ExpoNotificationChannelOpts } from "./types.js";

export class ExpoNotificationChannel implements NotificationsChannel {
  readonly name = "expo" as const;
  private readonly _opts: ExpoNotificationChannelOpts;
  private _permissionState: PermissionState = "default";

  constructor(opts: ExpoNotificationChannelOpts) {
    this._opts = opts;
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

      await this._opts.adapter.scheduleNotificationAsync({
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
      return { status: "delivered" };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
