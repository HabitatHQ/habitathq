import type {
  ChannelStatus,
  Notification,
  NotificationInteractionHandler,
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
  private _interactionHandler: NotificationInteractionHandler | undefined;
  private readonly _opts: BrowserNotificationChannelOpts;
  private readonly _active = new Set<{
    notification: Notification;
    instance: InstanceType<typeof globalThis.Notification>;
    timer: ReturnType<typeof setTimeout> | undefined;
    timedOut: boolean;
  }>();
  private _disposed = false;

  constructor(opts?: BrowserNotificationChannelOpts) {
    this._opts = opts ?? {};
  }
  setInteractionHandler(handler: NotificationInteractionHandler | undefined): void {
    this._interactionHandler = handler;
    if (handler !== undefined && this._disposed) this._disposed = false;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._interactionHandler = undefined;
    for (const active of this._active) {
      if (active.timer !== undefined) clearTimeout(active.timer);
      active.instance.onclick = null;
      active.instance.onclose = null;
    }
    this._active.clear();
  }

  isAvailable(): boolean {
    return (
      !this._disposed &&
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      Notification !== null
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
    if (this._disposed) return { status: "skipped", reason: "Notification channel is disposed" };
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
      const icon = this._opts.icon ?? notification.icon;
      const badge = this._opts.badge ?? notification.badge;

      const options: NotificationOptions & { image?: string } = {
        ...(notification.body === undefined ? {} : { body: notification.body }),
        ...(icon === undefined ? {} : { icon }),
        ...(badge === undefined ? {} : { badge }),
        ...(notification.image === undefined ? {} : { image: notification.image }),
        requireInteraction,
        ...(notification.id === undefined ? {} : { tag: notification.id }),
        ...(notification.data === undefined ? {} : { data: notification.data }),
      };
      const n = new Notification(notification.title, options);
      const active = {
        notification,
        instance: n,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
        timedOut: false,
      };
      this._active.add(active);
      const finish = () => {
        if (active.timer !== undefined) clearTimeout(active.timer);
        this._active.delete(active);
        n.onclick = null;
        n.onclose = null;
      };
      if (this._opts.autoDismissMs !== undefined) {
        active.timer = setTimeout(() => {
          active.timedOut = true;
          try {
            n.close();
          } finally {
            finish();
          }
        }, this._opts.autoDismissMs);
      }

      n.onclick = (event) => {
        event.preventDefault();
        try {
          if (typeof window !== "undefined") {
            window.focus();
            if (notification.deepLink !== undefined) window.location.href = notification.deepLink;
          }
        } finally {
          try {
            this._interactionHandler?.clicked(notification);
          } finally {
            try {
              this._opts.onNotificationClick?.(notification);
            } finally {
              finish();
              n.close();
            }
          }
        }
      };

      n.onclose = () => {
        try {
          if (!active.timedOut) {
            try {
              this._interactionHandler?.dismissed(notification);
            } finally {
              this._opts.onNotificationDismiss?.(notification);
            }
          }
        } finally {
          finish();
        }
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
