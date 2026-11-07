import type { ChannelName, Notification, PermissionState } from "./types.js";

export type NotificationEventMap = {
  beforesend: Readonly<{ notification: Notification; channels: ReadonlyArray<ChannelName> }>;
  delivered: Readonly<{ channel: ChannelName; notification: Notification }>;
  clicked: Readonly<{ channel: ChannelName; notification: Notification; actionId?: string }>;
  dismissed: Readonly<{ channel: ChannelName; notification: Notification }>;
  error: Readonly<{ channel: ChannelName; error: Error; notification: Notification }>;
  permissionchange: Readonly<{ channel: ChannelName; permission: PermissionState }>;
};

export type NotificationEvent = keyof NotificationEventMap;

export type NotificationEventHandler<E extends NotificationEvent> = (
  payload: NotificationEventMap[E],
) => void;

export type Unsubscribe = () => void;

export class NotificationsEventEmitter {
  private readonly _listeners = new Map<
    NotificationEvent,
    Set<NotificationEventHandler<NotificationEvent>>
  >();

  on<E extends NotificationEvent>(event: E, handler: NotificationEventHandler<E>): Unsubscribe {
    let handlers = this._listeners.get(event);
    if (handlers === undefined) {
      handlers = new Set();
      this._listeners.set(event, handlers);
    }
    handlers.add(handler as NotificationEventHandler<NotificationEvent>);
    return () => {
      handlers?.delete(handler as NotificationEventHandler<NotificationEvent>);
    };
  }

  emit<E extends NotificationEvent>(event: E, payload: NotificationEventMap[E]): void {
    const handlers = this._listeners.get(event);
    if (handlers === undefined) return;
    for (const handler of handlers) {
      if (event === "clicked" || event === "dismissed" || event === "permissionchange") {
        try {
          (handler as NotificationEventHandler<E>)(payload);
        } catch {
          // Observer failures must not interrupt interaction or permission delivery.
        }
      } else {
        (handler as NotificationEventHandler<E>)(payload);
      }
    }
  }
}
