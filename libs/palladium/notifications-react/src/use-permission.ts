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
    const channel = instance.getChannel(channelName);
    if (channel === undefined) {
      setPermission("not-applicable");
      return;
    }
    setPermission(channel.permissionStatus());
    return instance.on(
      "permissionchange",
      ({ channel: changedChannel, permission: nextPermission }) => {
        if (changedChannel === channelName) setPermission(nextPermission);
      },
    );
  }, [instance, channelName]);

  return permission;
}

export function useRequestPermission(channelName: ChannelName): () => Promise<PermissionState> {
  const instance = useNotificationsInstance();
  return useCallback(async () => {
    return instance.requestPermission(channelName);
  }, [instance, channelName]);
}
