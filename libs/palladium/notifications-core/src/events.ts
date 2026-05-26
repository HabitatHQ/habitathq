import type { ChannelName, Notification } from "./types.js";

export type NotificationEventMap = {
  beforesend: Readonly<{ notification: Notification; channels: ReadonlyArray<ChannelName> }>;
  delivered: Readonly<{ channel: ChannelName; notification: Notification }>;
  clicked: Readonly<{ channel: ChannelName; notification: Notification; actionId?: string }>;
  dismissed: Readonly<{ channel: ChannelName; notification: Notification }>;
  error: Readonly<{ channel: ChannelName; error: Error; notification: Notification }>;
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
    if (handlers !== undefined) {
      for (const handler of handlers) {
        (handler as NotificationEventHandler<E>)(payload);
      }
    }
  }
}
