import type { NotificationsInstance } from "@palladium/notifications-core";
import { createContext, type ReactNode, useContext } from "react";

const NotificationsContext = createContext<NotificationsInstance | null>(null);

export interface NotificationsProviderProps {
  instance: NotificationsInstance;
  children: ReactNode;
}

export function NotificationsProvider({
  instance,
  children,
}: NotificationsProviderProps): ReactNode {
  return <NotificationsContext.Provider value={instance}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsInstance(): NotificationsInstance {
  const instance = useContext(NotificationsContext);
  if (instance === null) {
    throw new TypeError("useNotifications must be used inside a <NotificationsProvider>.");
  }
  return instance;
}
