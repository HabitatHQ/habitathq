export interface ExpoNotificationContent {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: boolean | string;
  badge?: number;
  categoryIdentifier?: string;
}

export interface ExpoNotificationRequest {
  content: ExpoNotificationContent;
  trigger: null | { seconds?: number; date?: Date };
}

export interface ExpoNotificationSubscription {
  remove(): void;
}

export interface ExpoPermissionResponse {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

export interface ExpoNotificationsAdapter {
  requestPermissionsAsync(): Promise<ExpoPermissionResponse>;
  getPermissionsAsync(): Promise<ExpoPermissionResponse>;
  scheduleNotificationAsync(request: ExpoNotificationRequest): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  addNotificationReceivedListener(
    handler: (notification: { request: ExpoNotificationRequest }) => void,
  ): ExpoNotificationSubscription;
  addNotificationResponseReceivedListener(
    handler: (response: {
      notification: { request: ExpoNotificationRequest };
      actionIdentifier: string;
    }) => void,
  ): ExpoNotificationSubscription;
}

export interface ExpoNotificationChannelOpts {
  adapter: ExpoNotificationsAdapter;
  defaultCategoryIdentifier?: string;
}
