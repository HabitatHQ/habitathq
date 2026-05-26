import type {
  ChannelStatus,
  Notification,
  NotificationsChannel,
  PermissionState,
} from "@palladium/notifications-core";
import { HeadlessToastState } from "./headless.js";
import { isToastVariant } from "./types.js";

export interface ToastChannelOpts {
  maxVisible?: number;
  defaultDuration?: number;
}

export class ToastChannel implements NotificationsChannel {
  readonly name = "toast" as const;
  readonly headless: HeadlessToastState;
  private readonly _defaultDuration: number | undefined;

  constructor(opts?: ToastChannelOpts) {
    this.headless = new HeadlessToastState({ maxVisible: opts?.maxVisible });
    this._defaultDuration = opts?.defaultDuration;
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    const variant = this._inferVariant(notification);
    this.headless.add({
      title: notification.title,
      variant,
      ...(notification.id !== undefined && { id: notification.id }),
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
    this.headless.dismiss(id);
  }

  update(
    id: string,
    patch: Readonly<
      Partial<Pick<import("./types.js").ToastEntry, "title" | "body" | "icon" | "variant">>
    >,
  ): void {
    this.headless.update(id, patch);
  }

  private _inferVariant(notification: Notification): import("./types.js").ToastVariant {
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
