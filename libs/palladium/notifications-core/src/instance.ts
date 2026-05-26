import { NotificationBuilder } from "./builder.js";
import type { NotificationsChannel } from "./channel.js";
import {
  type NotificationEvent,
  type NotificationEventHandler,
  NotificationsEventEmitter,
  type Unsubscribe,
} from "./events.js";
import { type Middleware, type MiddlewareContext, runMiddleware } from "./middleware.js";
import type {
  ChannelName,
  ChannelStatus,
  ForegroundBehavior,
  Notification,
  NotificationResult,
  PermissionState,
  ShorthandOpts,
  UrgencyLevel,
} from "./types.js";

export interface NotificationsInstance {
  notify(title: string): NotificationBuilder;
  toast: Readonly<{
    success(title: string, opts?: ShorthandOpts): Promise<NotificationResult>;
    error(title: string, opts?: ShorthandOpts): Promise<NotificationResult>;
    warning(title: string, opts?: ShorthandOpts): Promise<NotificationResult>;
    info(title: string, opts?: ShorthandOpts): Promise<NotificationResult>;
    send(notification: Notification): Promise<NotificationResult>;
  }>;
  browser: Readonly<{
    send(notification: Notification): Promise<NotificationResult>;
    requestPermission(): Promise<PermissionState>;
    permissionStatus(): PermissionState;
  }>;
  use(middleware: Middleware): void;
  on<E extends NotificationEvent>(event: E, handler: NotificationEventHandler<E>): Unsubscribe;
  getChannel(name: ChannelName): NotificationsChannel | undefined;
  /** @internal — called by NotificationBuilder */
  _send(
    notification: Notification,
    channels: ReadonlyArray<ChannelName>,
    fallback: ReadonlyArray<ChannelName> | undefined,
  ): Promise<NotificationResult>;
}

export interface NotificationsConfig {
  channels?: Partial<Record<ChannelName, NotificationsChannel>>;
  fallback?: ReadonlyArray<ChannelName>;
  foregroundBehavior?: Partial<Record<ChannelName, ForegroundBehavior>>;
}

function buildShorthandNotification(
  title: string,
  urgency: UrgencyLevel,
  variant: string,
  opts: ShorthandOpts | undefined,
): Notification {
  return {
    title,
    urgency,
    data: { variant },
    ...(opts?.id !== undefined && { id: opts.id }),
    ...(opts?.body !== undefined && { body: opts.body }),
    ...(opts?.icon !== undefined && { icon: opts.icon }),
    ...(opts?.urgency !== undefined && { urgency: opts.urgency }),
  };
}

async function sendToChannels(
  notification: Notification,
  channelNames: ReadonlyArray<ChannelName>,
  channelMap: Map<ChannelName, NotificationsChannel>,
  emitter: NotificationsEventEmitter,
): Promise<{
  delivered: ChannelName[];
  failed: Array<Readonly<{ channel: ChannelName; error: Error }>>;
  skipped: Array<Readonly<{ channel: ChannelName; reason: string }>>;
}> {
  const delivered: ChannelName[] = [];
  const failed: Array<Readonly<{ channel: ChannelName; error: Error }>> = [];
  const skipped: Array<Readonly<{ channel: ChannelName; reason: string }>> = [];

  for (const name of channelNames) {
    const channel = channelMap.get(name);
    if (channel === undefined) {
      skipped.push({ channel: name, reason: `Channel "${name}" is not configured` });
      continue;
    }
    if (!channel.isAvailable()) {
      skipped.push({ channel: name, reason: `Channel "${name}" is not available` });
      continue;
    }

    const perm = channel.permissionStatus();
    if (perm === "default") {
      const granted = await channel.requestPermission();
      if (granted !== "granted") {
        skipped.push({ channel: name, reason: `Permission not granted for channel "${name}"` });
        continue;
      }
    } else if (perm === "denied") {
      skipped.push({ channel: name, reason: `Permission denied for channel "${name}"` });
      continue;
    }

    let result: ChannelStatus;
    try {
      result = await channel.send(notification);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failed.push({ channel: name, error });
      emitter.emit("error", { channel: name, error, notification });
      continue;
    }

    if (result.status === "delivered") {
      delivered.push(name);
      emitter.emit("delivered", { channel: name, notification });
    } else if (result.status === "failed") {
      failed.push({ channel: name, error: result.error });
      emitter.emit("error", { channel: name, error: result.error, notification });
    } else {
      skipped.push({ channel: name, reason: result.reason });
    }
  }

  return { delivered, failed, skipped };
}

export function createNotifications(config: NotificationsConfig = {}): NotificationsInstance {
  const channelMap = new Map<ChannelName, NotificationsChannel>();
  if (config.channels !== undefined) {
    const entries = Object.entries(config.channels) as Array<
      [ChannelName, NotificationsChannel | undefined]
    >;
    for (const [name, ch] of entries) {
      if (ch !== undefined) {
        channelMap.set(name, ch);
      }
    }
  }

  const emitter = new NotificationsEventEmitter();
  const middlewares: Middleware[] = [];

  const _send = async (
    notification: Notification,
    requestedChannels: ReadonlyArray<ChannelName>,
    perNotificationFallback: ReadonlyArray<ChannelName> | undefined,
  ): Promise<NotificationResult> => {
    // SSR guard
    if (typeof window === "undefined") {
      const channelsToSkip =
        requestedChannels.length > 0 ? requestedChannels : [...channelMap.keys()];
      return {
        delivered: [],
        failed: [],
        skipped: channelsToSkip.map((ch) => ({
          channel: ch,
          reason: "SSR: notifications not available on server",
        })),
      };
    }

    const channelsToUse = requestedChannels.length > 0 ? requestedChannels : [...channelMap.keys()];

    emitter.emit("beforesend", { notification, channels: channelsToUse });

    let resolvedCtx: MiddlewareContext | undefined;
    await runMiddleware(middlewares, { notification, channels: channelsToUse }, async (ctx) => {
      resolvedCtx = ctx;
    });

    if (resolvedCtx === undefined) {
      // Suppressed by middleware
      return {
        delivered: [],
        failed: [],
        skipped: channelsToUse.map((ch) => ({
          channel: ch,
          reason: "suppressed by middleware",
        })),
      };
    }

    const finalNotification = resolvedCtx.notification;
    const finalChannels = resolvedCtx.channels;

    const result = await sendToChannels(finalNotification, finalChannels, channelMap, emitter);

    // Try fallback if nothing delivered
    if (result.delivered.length === 0) {
      const effectiveFallback = perNotificationFallback ?? config.fallback;
      if (effectiveFallback !== undefined && effectiveFallback.length > 0) {
        const triedSet = new Set(finalChannels);
        const fallbackChannels = effectiveFallback.filter((ch) => !triedSet.has(ch));
        if (fallbackChannels.length > 0) {
          const fb = await sendToChannels(finalNotification, fallbackChannels, channelMap, emitter);
          result.delivered.push(...fb.delivered);
          result.failed.push(...fb.failed);
          result.skipped.push(...fb.skipped);
        }
      }
    }

    return {
      delivered: result.delivered,
      failed: result.failed,
      skipped: result.skipped,
    };
  };

  const toastShorthand = (
    title: string,
    urgency: UrgencyLevel,
    variant: string,
    opts?: ShorthandOpts,
  ) => _send(buildShorthandNotification(title, urgency, variant, opts), ["toast"], undefined);

  const instance: NotificationsInstance = {
    notify(title: string): NotificationBuilder {
      return new NotificationBuilder(title, _send);
    },

    toast: {
      success: (title, opts) => toastShorthand(title, "normal", "success", opts),
      error: (title, opts) => toastShorthand(title, "high", "error", opts),
      warning: (title, opts) => toastShorthand(title, "normal", "warning", opts),
      info: (title, opts) => toastShorthand(title, "low", "info", opts),
      send: (notification) => _send(notification, ["toast"], undefined),
    },

    browser: {
      send: (notification) => _send(notification, ["browser"], undefined),
      requestPermission: async () => {
        const ch = channelMap.get("browser");
        if (ch === undefined) return "not-applicable";
        return ch.requestPermission();
      },
      permissionStatus: () => {
        const ch = channelMap.get("browser");
        if (ch === undefined) return "not-applicable";
        return ch.permissionStatus();
      },
    },

    use(middleware: Middleware): void {
      middlewares.push(middleware);
    },

    on<E extends NotificationEvent>(event: E, handler: NotificationEventHandler<E>): Unsubscribe {
      return emitter.on(event, handler);
    },

    getChannel(name: ChannelName): NotificationsChannel | undefined {
      return channelMap.get(name);
    },

    _send,
  };

  return instance;
}
