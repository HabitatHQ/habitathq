import type {
  ChannelStatus,
  Notification,
  NotificationInteractionHandler,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import type { CapacitorNotificationChannelOpts } from "./types.js";

let _idCounter = 1;

function toNumericId(id: string | undefined): number {
  if (id === undefined) {
    const numericId = _idCounter;
    _idCounter = _idCounter === 0x7fffffff ? 1 : _idCounter + 1;
    return numericId;
  }
  // djb2 hash to numeric id
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    hash = ((hash << 5) + hash + code) >>> 0;
  }
  const numericId = hash & 0x7fffffff;
  return numericId === 0 ? 1 : numericId;
}

const notificationMetadataKey = "__palladium_notification";

function parseNotificationMetadata(extra: unknown): Notification | undefined {
  if (typeof extra !== "object" || extra === null || !(notificationMetadataKey in extra)) return;
  const serialized = extra[notificationMetadataKey];
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

export class CapacitorNotificationChannel implements NotificationsChannel {
  readonly name = "capacitor" as const;
  private readonly _opts: CapacitorNotificationChannelOpts;
  private _interactionHandler: NotificationInteractionHandler | undefined;
  private _actionListener: Promise<{ remove: () => Promise<void> }> | undefined;
  private _listenerError: Error | undefined;
  private _disposed = false;
  private _permissionState: PermissionState = "default";

  constructor(opts: CapacitorNotificationChannelOpts) {
    this._opts = opts;
    this._registerActionListener();
  }

  private _registerActionListener(): void {
    const local = this._opts.localNotifications;
    if (local === undefined) return;
    const listener = local
      .addListener("localNotificationActionPerformed", ({ actionId, notification }) => {
        const original = parseNotificationMetadata(notification.extra);
        if (original === undefined) return;
        if (actionId === "dismiss") this._interactionHandler?.dismissed(original);
        else this._interactionHandler?.clicked(original, actionId);
      })
      .catch((error: unknown) => {
        this._listenerError = error instanceof Error ? error : new Error(String(error));
        throw this._listenerError;
      });
    this._actionListener = listener;
    void listener.catch(() => {});
  }
  setInteractionHandler(handler: NotificationInteractionHandler | undefined): void {
    this._interactionHandler = handler;
    if (handler === undefined || !this._disposed) return;
    this._disposed = false;
    if (this._actionListener === undefined) {
      this._listenerError = undefined;
      this._registerActionListener();
    }
  }
  async dispose(): Promise<void> {
    this._disposed = true;
    this._interactionHandler = undefined;
    const listenerPromise = this._actionListener;
    if (listenerPromise === undefined) return;
    try {
      const handle = await listenerPromise;
      await handle.remove();
      this._actionListener = undefined;
    } catch {
      // Keep the listener promise so a later dispose() can retry registration cleanup.
    }
  }

  isAvailable(): boolean {
    return (
      !this._disposed &&
      this._listenerError === undefined &&
      (this._opts.localNotifications !== undefined || this._opts.pushNotifications !== undefined)
    );
  }

  permissionStatus(): PermissionState {
    return this._permissionState;
  }

  async requestPermission(): Promise<PermissionState> {
    if (this._disposed) return "not-applicable";
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
    if (this._disposed) return { status: "skipped", reason: "Notification channel is disposed" };
    const local = this._opts.localNotifications;
    if (local === undefined) {
      return { status: "skipped", reason: "No local notifications adapter configured" };
    }
    if (this._listenerError !== undefined) {
      return { status: "failed", error: this._listenerError };
    }
    try {
      if (this._actionListener !== undefined) await this._actionListener;
      if (this._disposed) return { status: "skipped", reason: "Notification channel is disposed" };
      const extra: Record<string, unknown> = {};
      if (notification.deepLink !== undefined) extra["deepLink"] = notification.deepLink;
      if (notification.data !== undefined) extra["data"] = notification.data;
      extra[notificationMetadataKey] = JSON.stringify(notification);
      const id = toNumericId(notification.id);
      await local.schedule({
        notifications: [
          {
            id,
            title: notification.title,
            ...(notification.body !== undefined && { body: notification.body }),
            extra,
          },
        ],
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
