import { describe, expect, it } from "vitest";
import { InMemoryDedupStore } from "../dedup.js";

describe("InMemoryDedupStore", () => {
  it("set() with explicit id returns that id", () => {
    const store = new InMemoryDedupStore();
    const id = store.set({ title: "Test", id: "abc" });
    expect(id).toBe("abc");
  });

  it("set() without id generates and returns a uuid", () => {
    const store = new InMemoryDedupStore();
    const id = store.set({ title: "Test" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("has() returns true after set()", () => {
    const store = new InMemoryDedupStore();
    const id = store.set({ title: "Test", id: "x" });
    expect(store.has(id)).toBe(true);
  });

  it("has() returns false for unknown id", () => {
    const store = new InMemoryDedupStore();
    expect(store.has("not-here")).toBe(false);
  });

  it("get() returns the stored notification", () => {
    const store = new InMemoryDedupStore();
    const notification = { title: "Hello", id: "n1", body: "World" };
    store.set(notification);
    const stored = store.get("n1");
    expect(stored?.title).toBe("Hello");
    expect(stored?.body).toBe("World");
  });

  it("delete() removes the entry", () => {
    const store = new InMemoryDedupStore();
    store.set({ title: "Test", id: "del" });
    store.delete("del");
    expect(store.has("del")).toBe(false);
  });

  it("delete() on nonexistent id does not throw", () => {
    const store = new InMemoryDedupStore();
    expect(() => store.delete("ghost")).not.toThrow();
  });

  it("clear() removes all entries", () => {
    const store = new InMemoryDedupStore();
    store.set({ title: "A", id: "a" });
    store.set({ title: "B", id: "b" });
    store.clear();
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(false);
  });

  it("set() with same id overwrites previous entry", () => {
    const store = new InMemoryDedupStore();
    store.set({ title: "First", id: "dup" });
    store.set({ title: "Second", id: "dup" });
    expect(store.get("dup")?.title).toBe("Second");
  });

  it("generated ids for different notifications are unique", () => {
    const store = new InMemoryDedupStore();
    const id1 = store.set({ title: "A" });
    const id2 = store.set({ title: "B" });
    expect(id1).not.toBe(id2);
  });
});
