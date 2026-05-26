import { describe, expect, it, vi } from "vitest";
import type { BuilderSendFn } from "../builder.js";
import { NotificationBuilder } from "../builder.js";
import type { NotificationResult } from "../types.js";

const mockResult: NotificationResult = { delivered: ["toast"], failed: [], skipped: [] };

function makeSendFn(): BuilderSendFn {
  return vi.fn().mockResolvedValue(mockResult);
}

describe("NotificationBuilder", () => {
  it("toNotification() with only title returns object with just title", () => {
    const fn = makeSendFn();
    const builder = new NotificationBuilder("Hello", fn);
    const n = builder.toNotification();
    expect(n).toEqual({ title: "Hello" });
    expect(Object.keys(n)).toEqual(["title"]);
  });

  it("toNotification() with all fields populates them", () => {
    const fn = makeSendFn();
    const n = new NotificationBuilder("Title", fn)
      .id("my-id")
      .body("Body text")
      .icon("/icon.png")
      .badge("/badge.png")
      .image("/img.png")
      .urgency("high")
      .withAction({ id: "view", label: "View" })
      .deepLink("/path")
      .toNotification();

    expect(n.title).toBe("Title");
    expect(n.id).toBe("my-id");
    expect(n.body).toBe("Body text");
    expect(n.icon).toBe("/icon.png");
    expect(n.badge).toBe("/badge.png");
    expect(n.image).toBe("/img.png");
    expect(n.urgency).toBe("high");
    expect(n.deepLink).toBe("/path");
    expect(n.actions).toEqual([{ id: "view", label: "View" }]);
  });

  it("withAction() accumulates multiple actions", () => {
    const fn = makeSendFn();
    const n = new NotificationBuilder("Title", fn)
      .withAction({ id: "a", label: "A" })
      .withAction({ id: "b", label: "B" })
      .toNotification();
    expect(n.actions).toHaveLength(2);
    expect(n.actions?.[0]?.id).toBe("a");
    expect(n.actions?.[1]?.id).toBe("b");
  });

  it("via() accumulates channels; calling twice appends", () => {
    const fn = makeSendFn();
    const builder = new NotificationBuilder("Title", fn).via("toast").via("browser");
    // send() to verify channels passed
    builder.send();
    expect(fn).toHaveBeenCalledWith(expect.any(Object), ["toast", "browser"], undefined);
  });

  it("withFallback() sets fallback", () => {
    const fn = makeSendFn();
    new NotificationBuilder("Title", fn).via("browser").withFallback(["toast"]).send();
    expect(fn).toHaveBeenCalledWith(expect.any(Object), ["browser"], ["toast"]);
  });

  it("send() with no via() passes empty channels array", () => {
    const fn = makeSendFn();
    new NotificationBuilder("Hello", fn).send();
    expect(fn).toHaveBeenCalledWith(expect.any(Object), [], undefined);
  });

  it("send() returns the promise from sendFn", async () => {
    const fn = makeSendFn();
    const result = await new NotificationBuilder("Hello", fn).send();
    expect(result).toBe(mockResult);
  });

  it("data() returns a new builder with typed data", () => {
    const fn = makeSendFn();
    const builder = new NotificationBuilder("Title", fn);
    const withData = builder.data({ orderId: "123" });
    expect(withData).not.toBe(builder);
    const n = withData.toNotification();
    expect(n.data).toEqual({ orderId: "123" });
  });

  it("data() preserves other fields on the new builder", () => {
    const fn = makeSendFn();
    const builder = new NotificationBuilder("Title", fn)
      .body("Body")
      .icon("/icon.png")
      .via("toast");
    const withData = builder.data(42);
    const n = withData.toNotification();
    expect(n.body).toBe("Body");
    expect(n.icon).toBe("/icon.png");
    expect(n.data).toBe(42);
  });

  it("does not include undefined optional fields in toNotification()", () => {
    const fn = makeSendFn();
    const n = new NotificationBuilder("Title", fn).toNotification();
    expect("body" in n).toBe(false);
    expect("icon" in n).toBe(false);
    expect("id" in n).toBe(false);
    expect("urgency" in n).toBe(false);
    expect("data" in n).toBe(false);
    expect("actions" in n).toBe(false);
  });

  it("actions are not included when no actions added", () => {
    const fn = makeSendFn();
    const n = new NotificationBuilder("Title", fn).toNotification();
    expect("actions" in n).toBe(false);
  });

  it("via() with multiple channel args at once", () => {
    const fn = makeSendFn();
    new NotificationBuilder("Title", fn).via("toast", "browser", "webPush").send();
    expect(fn).toHaveBeenCalledWith(expect.any(Object), ["toast", "browser", "webPush"], undefined);
  });
});
