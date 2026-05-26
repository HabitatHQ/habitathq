import type { ToastEntry, ToastState, ToastVariant } from "./types.js";

export interface HeadlessToastOpts {
  maxVisible?: number;
}

type AddInput = Omit<ToastEntry, "id" | "createdAt"> & { id?: string };

export class HeadlessToastState {
  private _toasts: ToastEntry[] = [];
  private readonly _maxVisible: number;
  private readonly _listeners = new Set<(state: ToastState) => void>();

  constructor(opts?: HeadlessToastOpts) {
    this._maxVisible = opts?.maxVisible ?? 5;
  }

  get state(): ToastState {
    return { toasts: this._toasts };
  }

  add(entry: AddInput): string {
    const id = entry.id ?? crypto.randomUUID();
    const toast: ToastEntry = {
      id,
      title: entry.title,
      variant: entry.variant,
      createdAt: Date.now(),
      ...(entry.body !== undefined && { body: entry.body }),
      ...(entry.icon !== undefined && { icon: entry.icon }),
      ...(entry.duration !== undefined && { duration: entry.duration }),
    };
    // Dedup: remove existing entry with same id
    this._toasts = this._toasts.filter((t) => t.id !== id);
    this._toasts.push(toast);
    // Trim oldest if over limit
    if (this._toasts.length > this._maxVisible) {
      this._toasts = this._toasts.slice(this._toasts.length - this._maxVisible);
    }
    this._notify();
    return id;
  }

  dismiss(id: string): void {
    const before = this._toasts.length;
    this._toasts = this._toasts.filter((t) => t.id !== id);
    if (this._toasts.length !== before) {
      this._notify();
    }
  }

  update(
    id: string,
    patch: Readonly<Partial<Pick<ToastEntry, "title" | "body" | "icon" | "variant">>>,
  ): void {
    let changed = false;
    this._toasts = this._toasts.map((t) => {
      if (t.id !== id) return t;
      changed = true;
      return {
        ...t,
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
        ...(patch.icon !== undefined && { icon: patch.icon }),
        ...(patch.variant !== undefined && { variant: patch.variant as ToastVariant }),
      };
    });
    if (changed) {
      this._notify();
    }
  }

  subscribe(listener: (state: ToastState) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  clear(): void {
    this._toasts = [];
    this._notify();
  }

  private _notify(): void {
    const state = this.state;
    for (const listener of this._listeners) {
      listener(state);
    }
  }
}
