export interface WebPushChannelOpts {
  vapidPublicKey: string;
  subscribeEndpoint?: string;
  unsubscribeEndpoint?: string;
  serviceWorkerUrl?: string;
  serviceWorkerScope?: string;
}

export type PushSubscriptionJSON = Readonly<{
  endpoint: string;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}
