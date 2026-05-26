import type { NotificationsChannel } from "@palladium/notifications-core";
import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { createNotificationsStore, createNotify } from "../stores.js";
import { createMockInstance } from "./helpers.js";

describe("createNotificationsStore", () => {
  it("returns object with expected shape", () => {
    const inst = createMockInstance();
    const store = createNotificationsStore(inst);
    expect(typeof store.notify).toBe("function");
    expect(typeof store.toast).toBe("object");
    expect(typeof store.browser).toBe("object");
    expect(typeof store.destroy).toBe("function");
    expect(store.browserPermission).toBeDefined();
  });

  it("browserPermission initial value from channel.permissionStatus()", () => {
    const inst = createMockInstance();
    const mockCh = {
      permissionStatus: vi.fn().mockReturnValue("granted"),
    } as unknown as NotificationsChannel;
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(mockCh);

    const store = createNotificationsStore(inst);
    expect(get(store.browserPermission)).toBe("granted");
    store.destroy();
  });

  it("browserPermission is 'not-applicable' when no browser channel", () => {
    const inst = createMockInstance();
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const store = createNotificationsStore(inst);
    expect(get(store.browserPermission)).toBe("not-applicable");
    store.destroy();
  });

  it("notify() returns a builder", () => {
    const inst = createMockInstance();
    const store = createNotificationsStore(inst);
    const builder = store.notify("Hello");
    expect(typeof builder.send).toBe("function");
    store.destroy();
  });

  it("toast.success() delegates to instance.toast.success", async () => {
    const inst = createMockInstance();
    const store = createNotificationsStore(inst);
    await store.toast.success("Saved");
    expect(inst.toast.success).toHaveBeenCalledWith("Saved");
    store.destroy();
  });

  it("browser.send() delegates to instance.browser.send", async () => {
    const inst = createMockInstance();
    const store = createNotificationsStore(inst);
    await store.browser.send({ title: "Test" });
    expect(inst.browser.send).toHaveBeenCalledWith({ title: "Test" });
    store.destroy();
  });

  it("destroy() does not throw", () => {
    const inst = createMockInstance();
    const store = createNotificationsStore(inst);
    expect(() => store.destroy()).not.toThrow();
  });

  it("subscribes to 'delivered' events on instance", () => {
    const inst = createMockInstance();
    createNotificationsStore(inst);
    expect(inst.on).toHaveBeenCalledWith("delivered", expect.any(Function));
  });
});

describe("createNotify", () => {
  it("returns function that calls instance.notify", () => {
    const inst = createMockInstance();
    const notify = createNotify(inst);
    notify("Hello");
    expect(inst.notify).toHaveBeenCalledWith("Hello");
  });
});
