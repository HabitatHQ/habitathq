import { describe, expect, it } from "vitest";
import { MockChannel } from "../mock.js";

describe("MockChannel", () => {
  it("default send() returns delivered status", async () => {
    const ch = new MockChannel("toast");
    const result = await ch.send({ title: "Hello" });
    expect(result.status).toBe("delivered");
  });

  it("setBehavior('failed') makes send() return failed", async () => {
    const ch = new MockChannel("toast");
    ch.setBehavior("failed", { error: new Error("bad") });
    const result = await ch.send({ title: "Hello" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toBe("bad");
    }
  });

  it("setBehavior('skipped') makes send() return skipped", async () => {
    const ch = new MockChannel("toast");
    ch.setBehavior("skipped", { reason: "no reason" });
    const result = await ch.send({ title: "Hello" });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("no reason");
    }
  });

  it("sentNotifications records all sent notifications", async () => {
    const ch = new MockChannel("browser");
    await ch.send({ title: "A" });
    await ch.send({ title: "B" });
    expect(ch.sentNotifications).toHaveLength(2);
    expect(ch.sentNotifications[0]?.title).toBe("A");
    expect(ch.sentNotifications[1]?.title).toBe("B");
  });

  it("clear() resets sentNotifications", async () => {
    const ch = new MockChannel("toast");
    await ch.send({ title: "Test" });
    ch.clear();
    expect(ch.sentNotifications).toHaveLength(0);
  });

  it("setPermissionState() changes permissionStatus()", () => {
    const ch = new MockChannel("browser");
    ch.setPermissionState("denied");
    expect(ch.permissionStatus()).toBe("denied");
  });

  it("requestPermission() returns configured state", async () => {
    const ch = new MockChannel("browser", { permissionState: "denied" });
    const result = await ch.requestPermission();
    expect(result).toBe("denied");
  });

  it("setAvailable(false) changes isAvailable()", () => {
    const ch = new MockChannel("toast");
    ch.setAvailable(false);
    expect(ch.isAvailable()).toBe(false);
  });

  it("constructor opts configure initial state", () => {
    const ch = new MockChannel("expo", {
      permissionState: "default",
      available: false,
      behavior: "skipped",
    });
    expect(ch.permissionStatus()).toBe("default");
    expect(ch.isAvailable()).toBe(false);
  });

  it("name is set from constructor", () => {
    const ch = new MockChannel("capacitor");
    expect(ch.name).toBe("capacitor");
  });

  it("default isAvailable() is true", () => {
    const ch = new MockChannel("toast");
    expect(ch.isAvailable()).toBe(true);
  });

  it("default permissionStatus() is granted", () => {
    const ch = new MockChannel("toast");
    expect(ch.permissionStatus()).toBe("granted");
  });

  it("send() records notification even when behavior is failed", async () => {
    const ch = new MockChannel("toast");
    ch.setBehavior("failed");
    await ch.send({ title: "Oops" });
    expect(ch.sentNotifications).toHaveLength(1);
  });
});
