import type { NotificationsChannel } from "@palladium/notifications-core";
import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { NotificationsState } from "../state.js";
import { createMockInstance } from "./helpers.js";

describe("NotificationsState", () => {
  it("creates state with initial browserPermission from channel", () => {
    const inst = createMockInstance();
    const mockCh = {
      permissionStatus: vi.fn().mockReturnValue("granted"),
    } as unknown as NotificationsChannel;
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(mockCh);

    const state = new NotificationsState(inst);
    expect(get(state.browserPermission)).toBe("granted");
  });

  it("creates state with 'not-applicable' when no browser channel", () => {
    const inst = createMockInstance();
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const state = new NotificationsState(inst);
    expect(get(state.browserPermission)).toBe("not-applicable");
  });

  it("notify() delegates to instance.notify", () => {
    const inst = createMockInstance();
    const state = new NotificationsState(inst);
    state.notify("Hello");
    expect(inst.notify).toHaveBeenCalledWith("Hello");
  });

  it("toast getter returns instance.toast", () => {
    const inst = createMockInstance();
    const state = new NotificationsState(inst);
    expect(state.toast).toBe(inst.toast);
  });

  it("browser getter returns instance.browser", () => {
    const inst = createMockInstance();
    const state = new NotificationsState(inst);
    expect(state.browser).toBe(inst.browser);
  });

  it("browserPermission is a readable store", () => {
    const inst = createMockInstance();
    const state = new NotificationsState(inst);
    expect(typeof state.browserPermission.subscribe).toBe("function");
  });

  it("subscribes to 'delivered' events on construction", () => {
    const inst = createMockInstance();
    new NotificationsState(inst);
    expect(inst.on).toHaveBeenCalledWith("delivered", expect.any(Function));
  });
});
