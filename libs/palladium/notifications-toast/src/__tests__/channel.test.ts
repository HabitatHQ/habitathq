import { createNotifications, MockChannel } from "@palladium/notifications-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastChannel } from "../channel.js";

describe("ToastChannel", () => {
  it("send() returns delivered status", async () => {
    const ch = new ToastChannel();
    const result = await ch.send({ title: "Hello" });
    expect(result.status).toBe("delivered");
  });

  it("send() adds entry to headless state", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Test" });
    expect(ch.headless.state.toasts).toHaveLength(1);
    expect(ch.headless.state.toasts[0]?.title).toBe("Test");
  });

  it("send() infers variant from notification.data.variant", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Success!", data: { variant: "success" } });
    expect(ch.headless.state.toasts[0]?.variant).toBe("success");
  });

  it("send() uses 'default' variant when no data", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Plain" });
    expect(ch.headless.state.toasts[0]?.variant).toBe("default");
  });

  it("send() uses 'default' variant when data has no variant", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Plain", data: { something: "else" } });
    expect(ch.headless.state.toasts[0]?.variant).toBe("default");
  });

  it("send() uses 'default' variant when data.variant is invalid", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Plain", data: { variant: "not-a-variant" } });
    expect(ch.headless.state.toasts[0]?.variant).toBe("default");
  });

  it("requestPermission() returns not-applicable", async () => {
    const ch = new ToastChannel();
    expect(await ch.requestPermission()).toBe("not-applicable");
  });

  it("permissionStatus() returns not-applicable", () => {
    const ch = new ToastChannel();
    expect(ch.permissionStatus()).toBe("not-applicable");
  });

  it("isAvailable() always returns true", () => {
    const ch = new ToastChannel();
    expect(ch.isAvailable()).toBe(true);
  });

  it("send() uses notification.id as toast id", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Idempotent", id: "fixed-id" });
    expect(ch.headless.state.toasts[0]?.id).toBe("fixed-id");
  });

  it("send() passes body to headless state", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Title", body: "Body text" });
    expect(ch.headless.state.toasts[0]?.body).toBe("Body text");
  });

  it("send() passes icon to headless state", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Title", icon: "/icon.png" });
    expect(ch.headless.state.toasts[0]?.icon).toBe("/icon.png");
  });

  it("dismiss() delegates to headless state", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Title", id: "t1" });
    ch.dismiss("t1");
    expect(ch.headless.state.toasts).toHaveLength(0);
  });

  it("update() delegates to headless state", async () => {
    const ch = new ToastChannel();
    await ch.send({ title: "Original", id: "t1" });
    ch.update("t1", { title: "Updated" });
    expect(ch.headless.state.toasts[0]?.title).toBe("Updated");
  });

  it("name is 'toast'", () => {
    const ch = new ToastChannel();
    expect(ch.name).toBe("toast");
  });
});

describe("foreground delivery policy", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { visibilityState: "visible" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function forbiddenChannel(name: "browser" | "capacitor" | "expo") {
    const channel = new MockChannel(name, { permissionState: "default" });
    const request = vi
      .spyOn(channel, "requestPermission")
      .mockRejectedValue(new Error("Foreground delivery must not request permission"));
    const send = vi
      .spyOn(channel, "send")
      .mockRejectedValue(new Error("Foreground delivery must not create browser/native UI"));
    return { channel, request, send };
  }

  it("suppresses the original foreground toast reproduction", async () => {
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { toast },
      foregroundBehavior: { toast: "suppress" },
    });

    const result = await inst.notify("Should be suppressed").via("toast").send();

    expect(result).toEqual({
      delivered: [],
      failed: [],
      skipped: [{ channel: "toast", reason: expect.any(String) }],
    });
    expect(toast.headless.state.toasts).toEqual([]);
  });

  it.each(["browser", "capacitor", "expo"] as const)(
    "suppresses %s without prompting or sending",
    async (name) => {
      const { channel, request, send } = forbiddenChannel(name);
      const inst = createNotifications({
        channels: { [name]: channel },
        foregroundBehavior: { [name]: "suppress" },
      });
      const permissionChange = vi.fn();
      const delivered = vi.fn();
      const error = vi.fn();
      inst.on("permissionchange", permissionChange);
      inst.on("delivered", delivered);
      inst.on("error", error);

      const result = await inst.notify("Quiet foreground").via(name).send();

      expect(result).toEqual({
        delivered: [],
        failed: [],
        skipped: [{ channel: name, reason: expect.any(String) }],
      });
      expect(request).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(permissionChange).not.toHaveBeenCalled();
      expect(delivered).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["visible", "show"],
    ["hidden", "suppress"],
    ["hidden", "toast-only"],
  ] as const)(
    "retains ordinary permission and delivery for %s / %s",
    async (visibility, policy) => {
      vi.stubGlobal("document", { visibilityState: visibility });
      const browser = new MockChannel("browser", { permissionState: "default" });
      const request = vi.spyOn(browser, "requestPermission").mockImplementation(async () => {
        browser.setPermissionState("granted");
        return "granted";
      });
      const toast = new ToastChannel();
      const inst = createNotifications({
        channels: { browser, toast },
        foregroundBehavior: { browser: policy },
      });
      const permissionChange = vi.fn();
      inst.on("permissionchange", permissionChange);

      const result = await inst.notify("Ordinary delivery").via("browser").send();

      expect(result).toEqual({ delivered: ["browser"], failed: [], skipped: [] });
      expect(browser.sentNotifications).toEqual([{ title: "Ordinary delivery" }]);
      expect(request).toHaveBeenCalledOnce();
      expect(permissionChange).toHaveBeenCalledWith({ channel: "browser", permission: "granted" });
      expect(toast.headless.state.toasts).toEqual([]);
    },
  );

  it("leaves hidden toast delivery enabled despite its suppress policy", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { toast },
      foregroundBehavior: { toast: "suppress" },
    });

    const result = await inst.toast.info("Background toast");

    expect(result).toEqual({ delivered: ["toast"], failed: [], skipped: [] });
    expect(toast.headless.state.toasts).toEqual([
      expect.objectContaining({ title: "Background toast", variant: "info" }),
    ]);
  });

  it.each([
    ["browser", "capacitor", "toast"],
    ["toast", "browser", "capacitor"],
    ["browser", "capacitor"],
  ] as const)(
    "redirects mixed selection %j to exactly one observable toast",
    async (...channels) => {
      const browser = forbiddenChannel("browser");
      const capacitor = forbiddenChannel("capacitor");
      const toast = new ToastChannel();
      const updates = vi.fn();
      toast.headless.subscribe(updates);
      const inst = createNotifications({
        channels: { browser: browser.channel, capacitor: capacitor.channel, toast },
        foregroundBehavior: { browser: "toast-only", capacitor: "toast-only" },
      });
      const delivered = vi.fn();
      inst.on("delivered", delivered);

      const result = await inst
        .notify("One foreground toast")
        .body("Details")
        .via(...channels)
        .send();

      expect(result.delivered).toEqual(["toast"]);
      expect(result.failed).toEqual([]);
      expect(result.skipped).toEqual([
        { channel: "browser", reason: expect.any(String) },
        { channel: "capacitor", reason: expect.any(String) },
      ]);
      expect(toast.headless.state.toasts).toEqual([
        expect.objectContaining({ title: "One foreground toast", body: "Details" }),
      ]);
      expect(updates).toHaveBeenCalledOnce();
      expect(delivered).toHaveBeenCalledOnce();
      expect(delivered).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "toast",
          notification: expect.objectContaining({ title: "One foreground toast" }),
        }),
      );
      expect(browser.request).not.toHaveBeenCalled();
      expect(browser.send).not.toHaveBeenCalled();
      expect(capacitor.request).not.toHaveBeenCalled();
      expect(capacitor.send).not.toHaveBeenCalled();
    },
  );

  it("applies policy after middleware resolves channels and notification content", async () => {
    const browser = forbiddenChannel("browser");
    const capacitor = forbiddenChannel("capacitor");
    const expo = new MockChannel("expo");
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { browser: browser.channel, capacitor: capacitor.channel, expo, toast },
      foregroundBehavior: { browser: "suppress", capacitor: "toast-only", expo: "show" },
    });
    inst.use(async (ctx, next) => {
      await next({
        notification: { ...ctx.notification, title: "Resolved title" },
        channels: ["browser", "capacitor", "expo", "toast"],
      });
    });

    const result = await inst.notify("Original title").via("expo").send();

    expect(new Set(result.delivered)).toEqual(new Set(["expo", "toast"]));
    expect(result.failed).toEqual([]);
    expect(result.skipped.map(({ channel }) => channel)).toEqual(["browser", "capacitor"]);
    expect(expo.sentNotifications).toEqual([{ title: "Resolved title" }]);
    expect(toast.headless.state.toasts).toEqual([
      expect.objectContaining({ title: "Resolved title" }),
    ]);
    expect(browser.request).not.toHaveBeenCalled();
    expect(browser.send).not.toHaveBeenCalled();
    expect(capacitor.request).not.toHaveBeenCalled();
    expect(capacitor.send).not.toHaveBeenCalled();
  });

  it.each(["config", "notification"] as const)(
    "enforces policy on %s fallback channels",
    async (scope) => {
      const expo = new MockChannel("expo", { behavior: "failed" });
      const browser = forbiddenChannel("browser");
      const capacitor = forbiddenChannel("capacitor");
      const toast = new ToastChannel();
      const inst = createNotifications({
        channels: { expo, browser: browser.channel, capacitor: capacitor.channel, toast },
        fallback: scope === "config" ? ["browser", "capacitor", "toast"] : ["browser"],
        foregroundBehavior: { browser: "suppress", capacitor: "toast-only" },
      });
      const builder = inst.notify("Fallback toast").via("expo");
      if (scope === "notification") builder.withFallback(["browser", "capacitor", "toast"]);

      const result = await builder.send();

      expect(result.delivered).toEqual(["toast"]);
      expect(result.failed.map(({ channel }) => channel)).toEqual(["expo"]);
      expect(result.skipped.map(({ channel }) => channel)).toEqual(["browser", "capacitor"]);
      expect(toast.headless.state.toasts).toEqual([
        expect.objectContaining({ title: "Fallback toast" }),
      ]);
      expect(browser.request).not.toHaveBeenCalled();
      expect(browser.send).not.toHaveBeenCalled();
      expect(capacitor.request).not.toHaveBeenCalled();
      expect(capacitor.send).not.toHaveBeenCalled();
    },
  );

  it("does not let fallback retry a redirected toast that was denied permission", async () => {
    const browser = forbiddenChannel("browser");
    const capacitor = forbiddenChannel("capacitor");
    const toast = new ToastChannel();
    vi.spyOn(toast, "permissionStatus").mockReturnValue("default");
    const request = vi.spyOn(toast, "requestPermission").mockResolvedValue("denied");
    const inst = createNotifications({
      channels: { browser: browser.channel, capacitor: capacitor.channel, toast },
      foregroundBehavior: { browser: "toast-only", capacitor: "toast-only" },
      fallback: ["capacitor", "toast"],
    });

    const result = await inst.notify("Denied redirect").via("browser").send();

    expect(result.delivered).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(new Set(result.skipped.map(({ channel }) => channel))).toEqual(
      new Set(["browser", "capacitor", "toast"]),
    );
    expect(request).toHaveBeenCalledOnce();
    expect(toast.headless.state.toasts).toEqual([]);
    expect(browser.request).not.toHaveBeenCalled();
    expect(capacitor.request).not.toHaveBeenCalled();
  });

  it("never invents a toast channel or falls back to the original native channel", async () => {
    const browser = forbiddenChannel("browser");
    const inst = createNotifications({
      channels: { browser: browser.channel },
      foregroundBehavior: { browser: "toast-only" },
      fallback: ["browser"],
    });

    const result = await inst.browser.send({ title: "No configured toast" });

    expect(result).toEqual({
      delivered: [],
      failed: [],
      skipped: [{ channel: "browser", reason: expect.any(String) }],
    });
    expect(browser.request).not.toHaveBeenCalled();
    expect(browser.send).not.toHaveBeenCalled();
  });

  it("honors the toast channel's own suppress policy after redirection", async () => {
    const browser = forbiddenChannel("browser");
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { browser: browser.channel, toast },
      foregroundBehavior: { browser: "toast-only", toast: "suppress" },
      fallback: ["toast"],
    });

    const result = await inst.notify("No foreground UI").via("browser").send();

    expect(result.delivered).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped.map(({ channel }) => channel)).toEqual(["browser", "toast"]);
    expect(toast.headless.state.toasts).toEqual([]);
    expect(browser.request).not.toHaveBeenCalled();
    expect(browser.send).not.toHaveBeenCalled();
  });

  it("treats toast-only on toast itself as a single toast delivery", async () => {
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { toast },
      foregroundBehavior: { toast: "toast-only" },
    });

    const result = await inst.toast.send({ title: "Already toast" });

    expect(result).toEqual({ delivered: ["toast"], failed: [], skipped: [] });
    expect(toast.headless.state.toasts).toEqual([
      expect.objectContaining({ title: "Already toast" }),
    ]);
  });

  it("retains SSR skip behavior when neither window nor document exists", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    const browser = forbiddenChannel("browser");
    const toast = new ToastChannel();
    const inst = createNotifications({
      channels: { browser: browser.channel, toast },
      foregroundBehavior: { browser: "toast-only" },
      fallback: ["toast"],
    });

    const result = await inst.notify("Server notification").via("browser").send();

    expect(result).toEqual({
      delivered: [],
      failed: [],
      skipped: [{ channel: "browser", reason: expect.stringContaining("SSR") }],
    });
    expect(toast.headless.state.toasts).toEqual([]);
    expect(browser.request).not.toHaveBeenCalled();
    expect(browser.send).not.toHaveBeenCalled();
  });
});
