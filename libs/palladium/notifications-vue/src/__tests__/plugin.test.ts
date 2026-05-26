import type { NotificationsInstance } from "@palladium/notifications-core";
import { describe, expect, it } from "vitest";
import { createApp, defineComponent, inject } from "vue";
import { NOTIFICATIONS_KEY, NotificationsPlugin } from "../plugin.js";
import { createMockInstance } from "./helpers.js";

describe("NotificationsPlugin", () => {
  it("installs without error", () => {
    const app = createApp(defineComponent({ template: "<div/>" }));
    const inst = createMockInstance();
    expect(() => app.use(NotificationsPlugin, { instance: inst })).not.toThrow();
  });

  it("provides instance under NOTIFICATIONS_KEY", () => {
    let captured: NotificationsInstance | undefined;
    const Comp = defineComponent({
      setup() {
        captured = inject<NotificationsInstance>(NOTIFICATIONS_KEY);
        return {};
      },
      template: "<div/>",
    });
    const app = createApp(Comp);
    const inst = createMockInstance();
    app.use(NotificationsPlugin, { instance: inst });
    const div = document.createElement("div");
    app.mount(div);
    expect(captured).toBe(inst);
    app.unmount();
  });
});
