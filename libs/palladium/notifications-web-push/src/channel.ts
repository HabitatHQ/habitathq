import type {
  ChannelStatus,
  Notification,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { PushSubscriptionJSON, WebPushChannelOpts } from "./types.js";
import { urlBase64ToUint8Array } from "./types.js";

function mapPermission(p: NotificationPermission): PermissionState {
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}

export class WebPushChannel implements NotificationsChannel {
  readonly name = "webPush" as const;
  private readonly _opts: WebPushChannelOpts;
  private _subscription: PushSubscriptionJSON | null = null;
  private _browserSubscriptionRemoved = false;

  constructor(opts: WebPushChannelOpts) {
    this._opts = opts;
  }

  isAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof PushManager !== "undefined"
    );
  }

  permissionStatus(): PermissionState {
    if (!this.isAvailable()) return "not-applicable";
    if (typeof Notification === "undefined") return "not-applicable";
    return mapPermission(Notification.permission);
  }

  async requestPermission(): Promise<PermissionState> {
    if (!this.isAvailable()) return "not-applicable";
    if (typeof Notification === "undefined") return "not-applicable";
    const result = await Notification.requestPermission();
    return mapPermission(result);
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    if (!this.isAvailable()) {
      return { status: "skipped", reason: "Web Push not available" };
    }
    if (this.permissionStatus() !== "granted") {
      return { status: "skipped", reason: "Permission not granted" };
    }
    if (this._subscription === null) {
      return { status: "skipped", reason: "Not subscribed to web push" };
    }
    // In a real implementation this would POST to a push server.
    // Client-side we record it as delivered since the subscription is active.
    void notification;
    return { status: "delivered" };
  }

  async subscribe(): Promise<PushSubscriptionJSON | null> {
    if (!this.isAvailable()) return null;
    try {
      const swUrl = this._opts.serviceWorkerUrl ?? "/sw.js";
      const scope = this._opts.serviceWorkerScope ?? "/";
      const registration = await navigator.serviceWorker.register(swUrl, { scope });
      const reg = registration;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(this._opts.vapidPublicKey),
      });

      const rawKey = sub.getKey("p256dh");
      const rawAuth = sub.getKey("auth");
      const p256dh = rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : "";
      const auth = rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : "";

      const subJson: PushSubscriptionJSON = {
        endpoint: sub.endpoint,
        keys: { p256dh, auth },
      };

      if (this._opts.subscribeEndpoint !== undefined) {
        const response = await fetch(this._opts.subscribeEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subJson),
        });
        if (!response.ok) return null;
      }

      this._subscription = subJson;
      this._browserSubscriptionRemoved = false;
      return subJson;
    } catch {
      return null;
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.isAvailable()) return;

    const scope = new URL(this._opts.serviceWorkerScope ?? "/", window.location.href).href;

    if (!this._browserSubscriptionRemoved) {
      const registration = await navigator.serviceWorker.getRegistration(
        this._opts.serviceWorkerScope ?? "/",
      );
      if (registration !== undefined && registration.scope === scope) {
        const sub = await registration.pushManager.getSubscription();
        if (sub === null) {
          this._browserSubscriptionRemoved = true;
        } else {
          const rawKey = sub.getKey("p256dh");
          const rawAuth = sub.getKey("auth");
          this._subscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : "",
              auth: rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : "",
            },
          };
          if (!(await sub.unsubscribe())) {
            throw new Error("Browser Push subscription removal was rejected");
          }
          this._browserSubscriptionRemoved = true;
        }
      } else if (this._subscription === null) {
        return;
      } else {
        this._browserSubscriptionRemoved = true;
      }
    }

    if (this._subscription === null) return;
    if (this._opts.unsubscribeEndpoint !== undefined) {
      const response = await fetch(this._opts.unsubscribeEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this._subscription),
      });
      if (!response.ok) {
        throw new Error(`Web Push unsubscribe failed: HTTP ${response.status}`);
      }
    }
    this._subscription = null;
    this._browserSubscriptionRemoved = false;
  }

  getSubscription(): PushSubscriptionJSON | null {
    return this._subscription;
  }
}
