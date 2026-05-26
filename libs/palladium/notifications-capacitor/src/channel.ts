import type {
  ChannelStatus,
  Notification,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { CapacitorNotificationChannelOpts } from "./types.js";

let _idCounter = 1;

function toNumericId(id: string | undefined): number {
  if (id === undefined) return _idCounter++;
  // djb2 hash to numeric id
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    hash = ((hash << 5) + hash + code) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

export class CapacitorNotificationChannel implements NotificationsChannel {
  readonly name = "capacitor" as const;
  private readonly _opts: CapacitorNotificationChannelOpts;
  private _permissionState: PermissionState = "default";

  constructor(opts: CapacitorNotificationChannelOpts) {
    this._opts = opts;
  }

  isAvailable(): boolean {
    return (
      this._opts.localNotifications !== undefined || this._opts.pushNotifications !== undefined
    );
  }

  permissionStatus(): PermissionState {
    return this._permissionState;
  }

  async requestPermission(): Promise<PermissionState> {
    const local = this._opts.localNotifications;
    if (local !== undefined) {
      const result = await local.requestPermissions();
      const mapped =
        result.display === "granted"
          ? "granted"
          : result.display === "denied"
            ? "denied"
            : "default";
      this._permissionState = mapped;
      return mapped;
    }
    const push = this._opts.pushNotifications;
    if (push !== undefined) {
      const result = await push.requestPermissions();
      const mapped =
        result.receive === "granted"
          ? "granted"
          : result.receive === "denied"
            ? "denied"
            : "default";
      this._permissionState = mapped;
      return mapped;
    }
    return "not-applicable";
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    const local = this._opts.localNotifications;
    if (local === undefined) {
      return { status: "skipped", reason: "No local notifications adapter configured" };
    }
    try {
      const extra: Record<string, unknown> = {};
      if (notification.deepLink !== undefined) {
        extra["deepLink"] = notification.deepLink;
      }
      if (notification.data !== undefined) {
        extra["data"] = notification.data;
      }
      await local.schedule({
        notifications: [
          {
            id: toNumericId(notification.id),
            title: notification.title,
            ...(notification.body !== undefined && { body: notification.body }),
            ...(Object.keys(extra).length > 0 && { extra }),
          },
        ],
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
