import type {
  ChannelStatus,
  Notification,
  NotificationInteractionHandler,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import { HeadlessToastState } from "./headless.js";
import type { ToastEntry, ToastVariant } from "./types.js";
import { isToastVariant } from "./types.js";

export interface ToastChannelOpts {
  maxVisible?: number;
  defaultDuration?: number;
}

export class ToastChannel implements NotificationsChannel {
  readonly name = "toast" as const;
  readonly headless: HeadlessToastState;
  private readonly _defaultDuration: number | undefined;
  private _interactionHandler: NotificationInteractionHandler | undefined;
  private readonly _notifications = new Map<string, Notification>();
  private readonly _unsubscribeState: () => void;
  private readonly _clicked = new Set<string>();

  constructor(opts?: ToastChannelOpts) {
    this.headless = new HeadlessToastState(
      opts?.maxVisible === undefined ? {} : { maxVisible: opts.maxVisible },
    );
    this._defaultDuration = opts?.defaultDuration;
    this._unsubscribeState = this.headless.subscribe((state) => {
      const visible = new Set<string>();
      for (const toast of state.toasts) visible.add(toast.id);
      for (const id of this._notifications.keys()) {
        if (visible.has(id)) continue;
        this._notifications.delete(id);
        this._clicked.delete(id);
      }
    });
  }

  setInteractionHandler(handler: NotificationInteractionHandler | undefined): void {
    this._interactionHandler = handler;
  }

  dispose(): void {
    this._interactionHandler = undefined;
    this._unsubscribeState();
    this._notifications.clear();
    this._clicked.clear();
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    const variant = this._inferVariant(notification);
    const id = notification.id ?? crypto.randomUUID();
    this._clicked.delete(id);
    this._notifications.set(id, notification);
    this.headless.add({
      title: notification.title,
      variant,
      id,
      ...(notification.body !== undefined && { body: notification.body }),
      ...(notification.icon !== undefined && { icon: notification.icon }),
      ...(this._defaultDuration !== undefined && { duration: this._defaultDuration }),
    });
    return { status: "delivered" };
  }

  async requestPermission(): Promise<PermissionState> {
    return "not-applicable";
  }

  permissionStatus(): PermissionState {
    return "not-applicable";
  }

  isAvailable(): boolean {
    return true;
  }

  dismiss(id: string): void {
    const notification = this._notifications.get(id);
    if (notification === undefined) return;
    this._notifications.delete(id);
    const clicked = this._clicked.delete(id);
    this.headless.dismiss(id);
    if (clicked) return;
    this._interactionHandler?.dismissed(notification);
  }

  click(id: string, actionId?: string): void {
    const notification = this._notifications.get(id);
    if (notification === undefined) return;
    this._clicked.add(id);
    this._interactionHandler?.clicked(notification, actionId);
  }

  update(
    id: string,
    patch: Readonly<Partial<Pick<ToastEntry, "title" | "body" | "icon" | "variant">>>,
  ): void {
    this.headless.update(id, patch);
  }

  private _inferVariant(notification: Notification): ToastVariant {
    if (
      typeof notification.data === "object" &&
      notification.data !== null &&
      "variant" in notification.data
    ) {
      const v = (notification.data as { variant: unknown })["variant"];
      if (isToastVariant(v)) return v;
    }
    return "default";
  }
}
