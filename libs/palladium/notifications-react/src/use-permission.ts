import type { ChannelName, PermissionState } from "@palladium/notifications-core";
import { useCallback, useEffect, useState } from "react";
import { useNotificationsInstance } from "./context.js";

export function usePermission(channelName: ChannelName): PermissionState {
  const instance = useNotificationsInstance();

  const [permission, setPermission] = useState<PermissionState>(() => {
    const ch = instance.getChannel(channelName);
    return ch?.permissionStatus() ?? "not-applicable";
  });

  useEffect(() => {
    const ch = instance.getChannel(channelName);
    if (ch === undefined) {
      setPermission("not-applicable");
      return;
    }
    setPermission(ch.permissionStatus());
    return instance.on("delivered", () => {
      setPermission(ch.permissionStatus());
    });
  }, [instance, channelName]);

  return permission;
}

export function useRequestPermission(channelName: ChannelName): () => Promise<PermissionState> {
  const instance = useNotificationsInstance();
  return useCallback(async () => {
    const ch = instance.getChannel(channelName);
    if (ch === undefined) return "not-applicable";
    return ch.requestPermission();
  }, [instance, channelName]);
}
