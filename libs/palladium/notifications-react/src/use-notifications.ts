import type {
  ChannelName,
  Middleware,
  NotificationBuilder,
  NotificationEvent,
  NotificationEventHandler,
  NotificationsChannel,
  NotificationsInstance,
  Unsubscribe,
} from "@palladium/notifications-core";
import { useCallback, useMemo } from "react";
import { useNotificationsInstance } from "./context.js";

export interface UseNotificationsReturn {
  notify(title: string): NotificationBuilder;
  toast: NotificationsInstance["toast"];
  browser: NotificationsInstance["browser"];
  use(middleware: Middleware): void;
  on<E extends NotificationEvent>(event: E, handler: NotificationEventHandler<E>): Unsubscribe;
  getChannel(name: ChannelName): NotificationsChannel | undefined;
}

export function useNotifications(): UseNotificationsReturn {
  const instance = useNotificationsInstance();

  const notify = useCallback((title: string) => instance.notify(title), [instance]);

  const toast = useMemo(() => instance.toast, [instance]);
  const browser = useMemo(() => instance.browser, [instance]);

  const use = useCallback((middleware: Middleware) => instance.use(middleware), [instance]);

  const on = useCallback(
    <E extends NotificationEvent>(event: E, handler: NotificationEventHandler<E>) =>
      instance.on(event, handler),
    [instance],
  );

  const getChannel = useCallback((name: ChannelName) => instance.getChannel(name), [instance]);

  return { notify, toast, browser, use, on, getChannel };
}
