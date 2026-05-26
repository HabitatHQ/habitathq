import { describe, expect, it } from "vitest";
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
