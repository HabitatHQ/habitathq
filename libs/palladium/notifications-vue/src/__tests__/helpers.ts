import type {
  ChannelName,
  NotificationBuilder,
  NotificationsChannel,
  NotificationsInstance,
} from "@palladium/notifications-core";
import { vi } from "vitest";

export function createMockInstance(): NotificationsInstance {
  const mockBuilder = {
    id: vi.fn().mockReturnThis(),
    body: vi.fn().mockReturnThis(),
    icon: vi.fn().mockReturnThis(),
    badge: vi.fn().mockReturnThis(),
    image: vi.fn().mockReturnThis(),
    urgency: vi.fn().mockReturnThis(),
    data: vi.fn().mockReturnThis(),
    withAction: vi.fn().mockReturnThis(),
    via: vi.fn().mockReturnThis(),
    withFallback: vi.fn().mockReturnThis(),
    deepLink: vi.fn().mockReturnThis(),
    toNotification: vi.fn().mockReturnValue({ title: "mock" }),
    send: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
  } as unknown as NotificationBuilder;

  return {
    notify: vi.fn().mockReturnValue(mockBuilder),
    toast: {
      success: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
      error: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
      warning: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
      info: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
      send: vi.fn().mockResolvedValue({ delivered: ["toast"], failed: [], skipped: [] }),
    },
    browser: {
      send: vi.fn().mockResolvedValue({ delivered: ["browser"], failed: [], skipped: [] }),
      requestPermission: vi.fn().mockResolvedValue("granted"),
      permissionStatus: vi.fn().mockReturnValue("granted"),
    },
    use: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    getChannel: vi.fn().mockReturnValue(undefined) as (
      name: ChannelName,
    ) => NotificationsChannel | undefined,
    _send: vi.fn().mockResolvedValue({ delivered: [], failed: [], skipped: [] }),
  };
}
