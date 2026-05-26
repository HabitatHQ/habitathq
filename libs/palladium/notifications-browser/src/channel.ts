import type {
  ChannelStatus,
  Notification,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { BrowserNotificationChannelOpts } from "./types.js";

function mapPermission(p: NotificationPermission): PermissionState {
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}

export class BrowserNotificationChannel implements NotificationsChannel {
  readonly name = "browser" as const;
  private readonly _opts: BrowserNotificationChannelOpts;

  constructor(opts?: BrowserNotificationChannelOpts) {
    this._opts = opts ?? {};
  }

  isAvailable(): boolean {
    return (
      typeof window !== "undefined" && typeof Notification !== "undefined" && Notification !== null
    );
  }

  permissionStatus(): PermissionState {
    if (!this.isAvailable()) return "not-applicable";
    return mapPermission(Notification.permission);
  }

  async requestPermission(): Promise<PermissionState> {
    if (!this.isAvailable()) return "not-applicable";
    const result = await Notification.requestPermission();
    return mapPermission(result);
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    if (!this.isAvailable()) {
      return { status: "skipped", reason: "Browser Notification API not available" };
    }
    const perm = this.permissionStatus();
    if (perm !== "granted") {
      return { status: "skipped", reason: `Permission not granted (${perm})` };
    }

    try {
      const requireInteraction =
        notification.urgency === "urgent" || (this._opts.requireInteraction ?? false);

      const n = new Notification(notification.title, {
        body: notification.body,
        icon: this._opts.icon ?? notification.icon,
        badge: this._opts.badge ?? notification.badge,
        image: notification.image,
        requireInteraction,
        tag: notification.id,
        data: notification.data,
      });

      if (this._opts.autoDismissMs !== undefined) {
        const ms = this._opts.autoDismissMs;
        setTimeout(() => n.close(), ms);
      }

      n.onclick = (event) => {
        event.preventDefault();
        if (typeof window !== "undefined") {
          window.focus();
          if (notification.deepLink !== undefined) {
            window.location.href = notification.deepLink;
          }
        }
        this._opts.onNotificationClick?.(notification);
        n.close();
      };

      n.onclose = () => {
        this._opts.onNotificationDismiss?.(notification);
      };

      return { status: "delivered" };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
