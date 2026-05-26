import type { Notification } from "./types.js";

export class InMemoryDedupStore {
  private readonly _store = new Map<string, Notification>();

  set(notification: Notification): string {
    const id = notification.id ?? crypto.randomUUID();
    const stored: Notification = {
      title: notification.title,
      ...(id !== undefined && { id }),
      ...(notification.body !== undefined && { body: notification.body }),
      ...(notification.icon !== undefined && { icon: notification.icon }),
      ...(notification.badge !== undefined && { badge: notification.badge }),
      ...(notification.image !== undefined && { image: notification.image }),
      ...(notification.urgency !== undefined && { urgency: notification.urgency }),
      ...(notification.data !== undefined && { data: notification.data }),
      ...(notification.actions !== undefined && { actions: notification.actions }),
      ...(notification.deepLink !== undefined && { deepLink: notification.deepLink }),
    };
    this._store.set(id, stored);
    return id;
  }

  get(id: string): Notification | undefined {
    return this._store.get(id);
  }

  has(id: string): boolean {
    return this._store.has(id);
  }

  delete(id: string): void {
    this._store.delete(id);
  }

  clear(): void {
    this._store.clear();
  }
}
