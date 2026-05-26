import type { NotificationsInstance } from "@palladium/notifications-core";
import { useMemo } from "react";
import { useNotificationsInstance } from "./context.js";

export function useToast(): NotificationsInstance["toast"] {
  const instance = useNotificationsInstance();
  return useMemo(() => instance.toast, [instance]);
}
