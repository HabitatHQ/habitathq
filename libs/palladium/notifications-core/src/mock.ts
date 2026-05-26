import type { NotificationsChannel } from "./channel.js";
import type { ChannelName, ChannelStatus, Notification, PermissionState } from "./types.js";

export interface MockChannelOpts {
  permissionState?: PermissionState;
  available?: boolean;
  behavior?: "delivered" | "failed" | "skipped";
  failError?: Error;
  skipReason?: string;
}

export class MockChannel implements NotificationsChannel {
  readonly name: ChannelName;
  private _permissionState: PermissionState;
  private _available: boolean;
  private _behavior: "delivered" | "failed" | "skipped";
  private _failError: Error;
  private _skipReason: string;
  private _sent: Notification[] = [];

  constructor(name: ChannelName, opts?: MockChannelOpts) {
    this.name = name;
    this._permissionState = opts?.permissionState ?? "granted";
    this._available = opts?.available ?? true;
    this._behavior = opts?.behavior ?? "delivered";
    this._failError = opts?.failError ?? new Error(`MockChannel(${name}): send failed`);
    this._skipReason = opts?.skipReason ?? "skipped";
  }

  get sentNotifications(): ReadonlyArray<Notification> {
    return this._sent;
  }

  async send(notification: Notification): Promise<ChannelStatus> {
    this._sent.push(notification);
    if (this._behavior === "failed") {
      return { status: "failed", error: this._failError };
    }
    if (this._behavior === "skipped") {
      return { status: "skipped", reason: this._skipReason };
    }
    return { status: "delivered" };
  }

  async requestPermission(): Promise<PermissionState> {
    return this._permissionState;
  }

  permissionStatus(): PermissionState {
    return this._permissionState;
  }

  isAvailable(): boolean {
    return this._available;
  }

  setPermissionState(state: PermissionState): void {
    this._permissionState = state;
  }

  setAvailable(available: boolean): void {
    this._available = available;
  }

  setBehavior(
    behavior: "delivered" | "failed" | "skipped",
    opts?: { error?: Error; reason?: string },
  ): void {
    this._behavior = behavior;
    if (opts?.error !== undefined) {
      this._failError = opts.error;
    }
    if (opts?.reason !== undefined) {
      this._skipReason = opts.reason;
    }
  }

  clear(): void {
    this._sent = [];
  }
}
