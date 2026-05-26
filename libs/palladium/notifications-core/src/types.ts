// @palladium/notifications-core — shared types

export type UrgencyLevel = "urgent" | "high" | "normal" | "low";

export type ChannelName = "toast" | "browser" | "webPush" | "capacitor" | "expo";

export type NotificationAction = Readonly<{
  id: string;
  label: string;
  icon?: string;
}>;

export type Notification<T = unknown> = Readonly<{
  id?: string;
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  image?: string;
  urgency?: UrgencyLevel;
  data?: T;
  actions?: ReadonlyArray<NotificationAction>;
  deepLink?: string;
}>;

export type ChannelStatus =
  | Readonly<{ status: "delivered" }>
  | Readonly<{ status: "failed"; error: Error }>
  | Readonly<{ status: "skipped"; reason: string }>;

export type NotificationResult = Readonly<{
  delivered: ReadonlyArray<ChannelName>;
  failed: ReadonlyArray<Readonly<{ channel: ChannelName; error: Error }>>;
  skipped: ReadonlyArray<Readonly<{ channel: ChannelName; reason: string }>>;
}>;

export type PermissionState = "granted" | "denied" | "default" | "not-applicable";

export type ForegroundBehavior = "show" | "suppress" | "toast-only";

export type ShorthandOpts = Readonly<{
  id?: string;
  body?: string;
  icon?: string;
  urgency?: UrgencyLevel;
}>;
