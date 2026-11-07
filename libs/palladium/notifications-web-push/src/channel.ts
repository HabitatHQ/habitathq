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

const ACTIVATION_TIMEOUT_MS = 30_000;

function waitForActivation(
  registration: ServiceWorkerRegistration,
  signal: AbortSignal,
): Promise<void> {
  const worker = registration.active ?? registration.installing ?? registration.waiting;
  if (worker === null) return Promise.reject(new Error("No service worker to activate"));
  if (worker.state === "activated") return Promise.resolve();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const cleanup = () => {
    clearTimeout(timeout);
    worker.removeEventListener("statechange", changed);
    signal.removeEventListener("abort", aborted);
  };
  const finish = (error?: Error) => {
    cleanup();
    if (error === undefined) resolve();
    else reject(error);
  };
  const changed = () => {
    if (worker.state === "activated") finish();
    else if (worker.state === "redundant") {
      finish(new Error("Service worker became redundant before activation"));
    }
  };
  const aborted = () => finish(new Error("Service worker activation wait was superseded"));
  const timeout = setTimeout(
    () => finish(new Error("Timed out waiting for service worker activation")),
    ACTIVATION_TIMEOUT_MS,
  );
  worker.addEventListener("statechange", changed);
  signal.addEventListener("abort", aborted);
  changed();
  if (signal.aborted) aborted();
  return promise;
}

export class WebPushChannel implements NotificationsChannel {
  readonly name = "webPush" as const;
  private readonly _opts: WebPushChannelOpts;
  private _subscription: PushSubscriptionJSON | null = null;
  private _browserSubscriptionRemoved = false;
  private _removedBrowserEndpoint: string | null = null;
  private _subscribeFlight: Promise<PushSubscriptionJSON | null> | null = null;
  private _subscribeAbort: AbortController | null = null;
  private _generation = 0;
  private _browserOperation: Promise<void> = Promise.resolve();

  private _withBrowser<T>(operation: () => Promise<T>): Promise<T> {
    const result = this._browserOperation.then(operation);
    this._browserOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

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
    if (this._subscription === null || this._browserSubscriptionRemoved) {
      return { status: "skipped", reason: "Not subscribed to web push" };
    }
    if (this._opts.sendEndpoint === undefined) {
      return { status: "skipped", reason: "Web Push send endpoint not configured" };
    }

    try {
      const response = await fetch(this._opts.sendEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: this._subscription, notification }),
      });
      if (!response.ok) {
        return {
          status: "failed",
          error: new Error(`Web Push send failed: HTTP ${response.status}`),
        };
      }
      return { status: "delivered" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  subscribe(): Promise<PushSubscriptionJSON | null> {
    if (!this.isAvailable()) return Promise.resolve(null);
    if (this._subscribeFlight !== null) return this._subscribeFlight;

    const generation = ++this._generation;
    const controller = new AbortController();
    this._subscribeAbort = controller;
    const flight = this._performSubscribe(generation, controller.signal);
    this._subscribeFlight = flight;
    const clearFlight = () => {
      if (this._subscribeFlight === flight) {
        this._subscribeFlight = null;
        this._subscribeAbort = null;
      }
    };
    void flight.then(clearFlight, clearFlight);
    return flight;
  }

  private async _performSubscribe(
    generation: number,
    signal: AbortSignal,
  ): Promise<PushSubscriptionJSON | null> {
    try {
      const sub = await this._withBrowser(async () => {
        if (generation !== this._generation || signal.aborted) return null;
        const swUrl = this._opts.serviceWorkerUrl ?? "/sw.js";
        const scope = this._opts.serviceWorkerScope ?? "/";
        const registration = await navigator.serviceWorker.register(swUrl, { scope });
        await waitForActivation(registration, signal);
        if (generation !== this._generation || signal.aborted) return null;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(this._opts.vapidPublicKey),
        });
        // A replacement browser subscription exists before its backend enrollment settles.
        this._removedBrowserEndpoint = null;
        return subscription;
      });
      if (sub === null || generation !== this._generation || signal.aborted) return null;

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

      if (generation !== this._generation || signal.aborted) return null;
      this._subscription = subJson;
      this._browserSubscriptionRemoved = false;
      return subJson;
    } catch {
      return null;
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.isAvailable()) return;

    const enrollment = this._subscribeFlight;
    this._subscribeAbort?.abort();
    this._subscribeAbort = null;
    this._subscribeFlight = null;
    const generation = ++this._generation;
    const subscription = await this._withBrowser(async () => {
      const scope = new URL(this._opts.serviceWorkerScope ?? "/", window.location.href).href;
      const registration = await navigator.serviceWorker.getRegistration(
        this._opts.serviceWorkerScope ?? "/",
      );
      if (registration === undefined || registration.scope !== scope) {
        if (this._subscription === null) return null;
        this._browserSubscriptionRemoved = true;
        return this._subscription;
      }
      const sub = await registration.pushManager.getSubscription();
      if (sub !== null && sub.endpoint !== this._removedBrowserEndpoint) {
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
        this._removedBrowserEndpoint = sub.endpoint;
      }
      this._browserSubscriptionRemoved = true;
      return this._subscription;
    });

    // A DELETE must cover a POST that was already admitted, even after cancellation.
    await enrollment;

    if (subscription === null) return;
    if (this._opts.unsubscribeEndpoint !== undefined) {
      const response = await fetch(this._opts.unsubscribeEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) {
        throw new Error(`Web Push unsubscribe failed: HTTP ${response.status}`);
      }
    }
    if (generation !== this._generation) return;
    this._subscription = null;
    this._browserSubscriptionRemoved = false;
  }

  getSubscription(): PushSubscriptionJSON | null {
    return this._subscription;
  }
}
