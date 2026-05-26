import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent } from "vue";
import { NotificationsPlugin } from "../plugin.js";
import { useNotifications } from "../use-notifications.js";
import { useToast } from "../use-toast.js";
import { createMockInstance } from "./helpers.js";

function withSetup<T>(composable: () => T, instance: ReturnType<typeof createMockInstance>): T {
  let result!: T;
  const Comp = defineComponent({
    setup() {
      result = composable();
      return {};
    },
    template: "<div/>",
  });
  const app = createApp(Comp);
  app.use(NotificationsPlugin, { instance });
  const div = document.createElement("div");
  app.mount(div);
  app.unmount();
  return result;
}

describe("useNotifications (Vue)", () => {
  it("returns instance", () => {
    const inst = createMockInstance();
    const result = withSetup(() => useNotifications(), inst);
    expect(result).toBe(inst);
  });

  it("throws when plugin not installed", () => {
    const Comp = defineComponent({
      setup() {
        useNotifications();
        return {};
      },
      template: "<div/>",
    });
    const app = createApp(Comp);
    const div = document.createElement("div");
    const originalWarn = console.warn;
    console.warn = () => {};
    expect(() => app.mount(div)).toThrow(
      "useNotifications() must be called inside a component that has the NotificationsPlugin installed.",
    );
    console.warn = originalWarn;
  });
});

describe("useToast (Vue)", () => {
  it("returns instance.toast", () => {
    const inst = createMockInstance();
    const result = withSetup(() => useToast(), inst);
    expect(result).toBe(inst.toast);
  });

  it("success() calls instance.toast.success", async () => {
    const inst = createMockInstance();
    const toast = withSetup(() => useToast(), inst);
    await toast.success("Saved");
    expect(inst.toast.success).toHaveBeenCalledWith("Saved");
  });
});

import { useBrowserNotification } from "../use-browser-notification.js";

describe("useBrowserNotification (Vue)", () => {
  it("permissionStatus reflects channel state", () => {
    const inst = createMockInstance();
    const mockCh = { permissionStatus: vi.fn().mockReturnValue("granted") };
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(mockCh);
    const result = withSetup(() => useBrowserNotification(), inst);
    expect(result.permissionStatus.value).toBe("granted");
  });

  it("returns not-applicable when no browser channel", () => {
    const inst = createMockInstance();
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const result = withSetup(() => useBrowserNotification(), inst);
    expect(result.permissionStatus.value).toBe("not-applicable");
  });

  it("requestPermission() updates permissionStatus ref", async () => {
    const inst = createMockInstance();
    (inst.browser.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("granted");
    const result = withSetup(() => useBrowserNotification(), inst);
    await result.requestPermission();
    expect(result.permissionStatus.value).toBe("granted");
  });
});
