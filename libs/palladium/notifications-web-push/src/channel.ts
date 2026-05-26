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
      const swRegistration = await navigator.serviceWorker.ready;
      const reg = swRegistration ?? registration;

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

      this._subscription = subJson;

      if (this._opts.subscribeEndpoint !== undefined) {
        await fetch(this._opts.subscribeEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subJson),
        });
      }

      return subJson;
    } catch {
      return null;
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.isAvailable() || this._subscription === null) return;
    try {
      const swRegistration = await navigator.serviceWorker.ready;
      const sub = await swRegistration.pushManager.getSubscription();
      if (sub !== null) {
        await sub.unsubscribe();
      }
      if (this._opts.unsubscribeEndpoint !== undefined) {
        await fetch(this._opts.unsubscribeEndpoint, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this._subscription),
        });
      }
      this._subscription = null;
    } catch {
      this._subscription = null;
    }
  }

  getSubscription(): PushSubscriptionJSON | null {
    return this._subscription;
  }
}
