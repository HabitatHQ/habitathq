export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export type ToastEntry = Readonly<{
  id: string;
  title: string;
  body?: string;
  icon?: string;
  variant: ToastVariant;
  createdAt: number;
  duration?: number;
}>;

export type ToastState = Readonly<{
  toasts: ReadonlyArray<ToastEntry>;
}>;

export function isToastVariant(v: unknown): v is ToastVariant {
  return v === "default" || v === "success" || v === "error" || v === "warning" || v === "info";
}
