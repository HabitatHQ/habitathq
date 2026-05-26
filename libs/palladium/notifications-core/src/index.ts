// @palladium/notifications-core — public API

export type { BuilderSendFn } from "./builder.js";
export { NotificationBuilder } from "./builder.js";
export type { NotificationsChannel } from "./channel.js";
export { InMemoryDedupStore } from "./dedup.js";
export type {
  NotificationEvent,
  NotificationEventHandler,
  NotificationEventMap,
  Unsubscribe,
} from "./events.js";
export { NotificationsEventEmitter } from "./events.js";
export type { NotificationsConfig, NotificationsInstance } from "./instance.js";
export { createNotifications } from "./instance.js";
export type { Middleware, MiddlewareContext, MiddlewareNext } from "./middleware.js";
export { runMiddleware } from "./middleware.js";
export type { MockChannelOpts } from "./mock.js";
export { MockChannel } from "./mock.js";
export type {
  ChannelName,
  ChannelStatus,
  ForegroundBehavior,
  Notification,
  NotificationAction,
  NotificationResult,
  PermissionState,
  ShorthandOpts,
  UrgencyLevel,
} from "./types.js";
