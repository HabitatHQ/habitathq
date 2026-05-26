import { describe, expect, it, vi } from "vitest";
import { HeadlessToastState } from "../headless.js";

describe("HeadlessToastState", () => {
  it("add() returns generated id when no id provided", () => {
    const state = new HeadlessToastState();
    const id = state.add({ title: "Hello", variant: "default" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("add() returns explicit id when provided", () => {
    const state = new HeadlessToastState();
    const id = state.add({ title: "Hello", variant: "success", id: "my-id" });
    expect(id).toBe("my-id");
  });

  it("add() appends to state.toasts", () => {
    const state = new HeadlessToastState();
    state.add({ title: "A", variant: "default" });
    state.add({ title: "B", variant: "error" });
    expect(state.state.toasts).toHaveLength(2);
  });

  it("add() deduplicates: adding same id replaces existing", () => {
    const state = new HeadlessToastState();
    state.add({ title: "First", variant: "default", id: "dup" });
    state.add({ title: "Second", variant: "success", id: "dup" });
    expect(state.state.toasts).toHaveLength(1);
    expect(state.state.toasts[0]?.title).toBe("Second");
  });

  it("respects maxVisible: oldest trimmed when over limit", () => {
    const state = new HeadlessToastState({ maxVisible: 3 });
    state.add({ title: "A", variant: "default", id: "a" });
    state.add({ title: "B", variant: "default", id: "b" });
    state.add({ title: "C", variant: "default", id: "c" });
    state.add({ title: "D", variant: "default", id: "d" });
    expect(state.state.toasts).toHaveLength(3);
    const ids = state.state.toasts.map((t) => t.id);
    expect(ids).not.toContain("a");
    expect(ids).toContain("d");
  });

  it("dismiss() removes by id", () => {
    const state = new HeadlessToastState();
    state.add({ title: "Keep", variant: "default", id: "keep" });
    state.add({ title: "Remove", variant: "error", id: "remove" });
    state.dismiss("remove");
    expect(state.state.toasts).toHaveLength(1);
    expect(state.state.toasts[0]?.id).toBe("keep");
  });

  it("dismiss() nonexistent id is a no-op", () => {
    const state = new HeadlessToastState();
    state.add({ title: "A", variant: "default" });
    expect(() => state.dismiss("ghost")).not.toThrow();
    expect(state.state.toasts).toHaveLength(1);
  });

  it("update() modifies specific toast by id", () => {
    const state = new HeadlessToastState();
    state.add({ title: "Original", variant: "default", id: "u" });
    state.update("u", { title: "Updated", variant: "success" });
    const toast = state.state.toasts[0];
    expect(toast?.title).toBe("Updated");
    expect(toast?.variant).toBe("success");
  });

  it("update() nonexistent id is a no-op", () => {
    const state = new HeadlessToastState();
    state.add({ title: "A", variant: "default", id: "a" });
    expect(() => state.update("ghost", { title: "X" })).not.toThrow();
    expect(state.state.toasts[0]?.title).toBe("A");
  });

  it("subscribe() is called on add()", () => {
    const state = new HeadlessToastState();
    const listener = vi.fn();
    state.subscribe(listener);
    state.add({ title: "Test", variant: "default" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("subscribe() is called on dismiss()", () => {
    const state = new HeadlessToastState();
    state.add({ title: "Test", variant: "default", id: "x" });
    const listener = vi.fn();
    state.subscribe(listener);
    state.dismiss("x");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("subscribe() is called on update()", () => {
    const state = new HeadlessToastState();
    state.add({ title: "Test", variant: "default", id: "x" });
    const listener = vi.fn();
    state.subscribe(listener);
    state.update("x", { title: "Updated" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("unsubscribe stops notifications", () => {
    const state = new HeadlessToastState();
    const listener = vi.fn();
    const unsub = state.subscribe(listener);
    unsub();
    state.add({ title: "Test", variant: "default" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear() removes all toasts and notifies", () => {
    const state = new HeadlessToastState();
    const listener = vi.fn();
    state.add({ title: "A", variant: "default" });
    state.add({ title: "B", variant: "default" });
    state.subscribe(listener);
    state.clear();
    expect(state.state.toasts).toHaveLength(0);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("add() sets createdAt to current timestamp", () => {
    const before = Date.now();
    const state = new HeadlessToastState();
    state.add({ title: "T", variant: "default" });
    const after = Date.now();
    const toast = state.state.toasts[0];
    expect(toast?.createdAt).toBeGreaterThanOrEqual(before);
    expect(toast?.createdAt).toBeLessThanOrEqual(after);
  });
});
