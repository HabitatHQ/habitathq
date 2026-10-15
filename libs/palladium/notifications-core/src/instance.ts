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
  requestPermission(name: ChannelName): Promise<PermissionState>;
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

async function sendToChannel(
  name: ChannelName,
  channel: NotificationsChannel,
  notification: Notification,
  requestPermission: (name: ChannelName) => Promise<PermissionState>,
): Promise<ChannelStatus> {
  try {
    const permission = channel.permissionStatus();
    if (permission === "default" && (await requestPermission(name)) !== "granted") {
      return { status: "skipped", reason: `Permission not granted for channel "${name}"` };
    }
    if (permission === "denied") {
      return { status: "skipped", reason: `Permission denied for channel "${name}"` };
    }
    return await channel.send(notification);
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function sendToChannels(
  notification: Notification,
  channelNames: ReadonlyArray<ChannelName>,
  channelMap: Map<ChannelName, NotificationsChannel>,
  emitter: NotificationsEventEmitter,
  requestPermission: (name: ChannelName) => Promise<PermissionState>,
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

    const result = await sendToChannel(name, channel, notification, requestPermission);

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

function applyForegroundBehavior(
  channelNames: ReadonlyArray<ChannelName>,
  channelMap: Map<ChannelName, NotificationsChannel>,
  foregroundBehavior: Partial<Record<ChannelName, ForegroundBehavior>> | undefined,
  visible: boolean,
  attempted: ReadonlySet<ChannelName> = new Set(),
): {
  channels: ChannelName[];
  attempted: Set<ChannelName>;
  skipped: Array<Readonly<{ channel: ChannelName; reason: string }>>;
} {
  const channels: ChannelName[] = [];
  const skipped: Array<Readonly<{ channel: ChannelName; reason: string }>> = [];
  const included: Partial<Record<ChannelName, true>> = {};
  let redirectToToast = false;
  const attemptedChannels = new Set(attempted);
  const skippedChannels: Partial<Record<ChannelName, true>> = {};
  const skip = (name: ChannelName, reason: string) => {
    if (skippedChannels[name] !== true) {
      skippedChannels[name] = true;
      skipped.push({ channel: name, reason });
    }
  };
  const include = (name: ChannelName) => {
    if (included[name] !== true) {
      included[name] = true;
      channels.push(name);
    }
  };

  for (const name of channelNames) {
    attemptedChannels.add(name);
    const behavior = visible ? foregroundBehavior?.[name] : undefined;
    if (behavior === "suppress") {
      skip(name, "suppressed by foreground policy");
    } else if (behavior === "toast-only" && name !== "toast") {
      skip(name, "redirected to toast by foreground policy");
      redirectToToast = true;
    } else {
      include(name);
    }
  }

  if (redirectToToast && channelMap.has("toast") && attemptedChannels.has("toast") !== true) {
    attemptedChannels.add("toast");
    const toastBehavior = visible ? foregroundBehavior?.toast : undefined;
    if (toastBehavior === "suppress") {
      skip("toast", "suppressed by foreground policy");
    } else {
      include("toast");
    }
  }

  return { channels, attempted: attemptedChannels, skipped };
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
  const requestPermission = async (name: ChannelName): Promise<PermissionState> => {
    const channel = channelMap.get(name);
    if (channel === undefined) return "not-applicable";
    const permission = await channel.requestPermission();
    emitter.emit("permissionchange", { channel: name, permission });
    return permission;
  };

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
    const visible = typeof document !== "undefined" && document.visibilityState === "visible";
    const initial = applyForegroundBehavior(
      finalChannels,
      channelMap,
      config.foregroundBehavior,
      visible,
    );
    const result = await sendToChannels(
      finalNotification,
      initial.channels,
      channelMap,
      emitter,
      requestPermission,
    );
    result.skipped.unshift(...initial.skipped);
    const attemptedChannels = initial.attempted;

    // Try fallback if nothing delivered
    if (result.delivered.length === 0) {
      const effectiveFallback = perNotificationFallback ?? config.fallback;
      if (effectiveFallback !== undefined && effectiveFallback.length > 0) {
        const fallbackChannels = effectiveFallback.filter((ch) => !attemptedChannels.has(ch));
        if (fallbackChannels.length > 0) {
          const fallback = applyForegroundBehavior(
            fallbackChannels,
            channelMap,
            config.foregroundBehavior,
            visible,
            attemptedChannels,
          );
          const fb = await sendToChannels(
            finalNotification,
            fallback.channels,
            channelMap,
            emitter,
            requestPermission,
          );
          result.delivered.push(...fb.delivered);
          for (const channel of fallback.attempted) attemptedChannels.add(channel);
          result.failed.push(...fb.failed);
          result.skipped.push(...fallback.skipped, ...fb.skipped);
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
    requestPermission,
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
      requestPermission: () => requestPermission("browser"),
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
