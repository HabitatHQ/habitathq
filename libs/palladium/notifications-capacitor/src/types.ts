export interface CapacitorLocalNotifications {
  requestPermissions(): Promise<{ display: "granted" | "denied" | "prompt" }>;
  checkPermissions(): Promise<{ display: "granted" | "denied" | "prompt" }>;
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body?: string;
      smallIcon?: string;
      channelId?: string;
      group?: string;
      groupSummary?: boolean;
      extra?: Record<string, unknown>;
      actionTypeId?: string;
      schedule?: { at?: Date };
    }>;
  }): Promise<{ notifications: Array<{ id: number }> }>;
  addListener(
    event: "localNotificationActionPerformed",
    handler: (data: {
      actionId: string;
      notification: { id: number; extra?: Record<string, unknown> };
    }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface CapacitorPushNotifications {
  requestPermissions(): Promise<{ receive: "granted" | "denied" | "prompt" }>;
  checkPermissions(): Promise<{ receive: "granted" | "denied" | "prompt" }>;
  register(): Promise<void>;
  addListener(
    event: "registration",
    handler: (token: { value: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "pushNotificationReceived",
    handler: (notification: {
      title?: string;
      body?: string;
      data?: Record<string, unknown>;
    }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "pushNotificationActionPerformed",
    handler: (result: { notification: { data?: Record<string, unknown> } }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "registrationError",
    handler: (error: { error: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface CapacitorAndroidChannel {
  id: string;
  name: string;
  importance?: 1 | 2 | 3 | 4 | 5;
  description?: string;
  sound?: string;
  vibration?: boolean;
}

export interface CapacitorNotificationChannelOpts {
  localNotifications?: CapacitorLocalNotifications;
  pushNotifications?: CapacitorPushNotifications;
  androidChannels?: ReadonlyArray<CapacitorAndroidChannel>;
}
