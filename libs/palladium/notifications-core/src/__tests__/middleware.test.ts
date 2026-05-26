import { describe, expect, it, vi } from "vitest";
import type { MiddlewareContext } from "../middleware.js";
import { runMiddleware } from "../middleware.js";

const baseCtx: MiddlewareContext = {
  notification: { title: "Hello" },
  channels: ["toast"],
};

describe("runMiddleware", () => {
  it("empty middlewares: calls final immediately", async () => {
    const final = vi.fn().mockResolvedValue(undefined);
    await runMiddleware([], baseCtx, final);
    expect(final).toHaveBeenCalledOnce();
    expect(final).toHaveBeenCalledWith(baseCtx);
  });

  it("single middleware that calls next: final is called", async () => {
    const final = vi.fn().mockResolvedValue(undefined);
    const mw = vi.fn(
      async (ctx: MiddlewareContext, next: (ctx: MiddlewareContext) => Promise<void>) => {
        await next(ctx);
      },
    );
    await runMiddleware([mw], baseCtx, final);
    expect(mw).toHaveBeenCalledOnce();
    expect(final).toHaveBeenCalledOnce();
  });

  it("single middleware that does NOT call next: final not called", async () => {
    const final = vi.fn().mockResolvedValue(undefined);
    const mw = vi.fn(async (_ctx: MiddlewareContext, _next: unknown) => {
      // suppress — do not call next
    });
    await runMiddleware([mw], baseCtx, final);
    expect(mw).toHaveBeenCalledOnce();
    expect(final).not.toHaveBeenCalled();
  });

  it("two middlewares are called in order", async () => {
    const order: number[] = [];
    const final = vi.fn().mockImplementation(async () => {
      order.push(3);
    });
    const mw1 = vi.fn(
      async (ctx: MiddlewareContext, next: (ctx: MiddlewareContext) => Promise<void>) => {
        order.push(1);
        await next(ctx);
      },
    );
    const mw2 = vi.fn(
      async (ctx: MiddlewareContext, next: (ctx: MiddlewareContext) => Promise<void>) => {
        order.push(2);
        await next(ctx);
      },
    );
    await runMiddleware([mw1, mw2], baseCtx, final);
    expect(order).toEqual([1, 2, 3]);
  });

  it("middleware can transform notification: modified value reaches final", async () => {
    let captured: MiddlewareContext | undefined;
    const final = vi.fn(async (ctx: MiddlewareContext) => {
      captured = ctx;
    });
    const mw = async (ctx: MiddlewareContext, next: (ctx: MiddlewareContext) => Promise<void>) => {
      await next({ ...ctx, notification: { ...ctx.notification, title: "Transformed" } });
    };
    await runMiddleware([mw], baseCtx, final);
    expect(captured?.notification.title).toBe("Transformed");
  });

  it("middleware can modify channels: modified channels reach final", async () => {
    let captured: MiddlewareContext | undefined;
    const final = vi.fn(async (ctx: MiddlewareContext) => {
      captured = ctx;
    });
    const mw = async (ctx: MiddlewareContext, next: (ctx: MiddlewareContext) => Promise<void>) => {
      await next({ ...ctx, channels: ["browser"] });
    };
    await runMiddleware([mw], baseCtx, final);
    expect(captured?.channels).toEqual(["browser"]);
  });

  it("error in middleware propagates out", async () => {
    const final = vi.fn().mockResolvedValue(undefined);
    const mw = async (_ctx: MiddlewareContext, _next: unknown) => {
      throw new Error("middleware boom");
    };
    await expect(runMiddleware([mw], baseCtx, final)).rejects.toThrow("middleware boom");
    expect(final).not.toHaveBeenCalled();
  });

  it("ctx is passed through a chain of three middlewares unchanged", async () => {
    let captured: MiddlewareContext | undefined;
    const final = async (ctx: MiddlewareContext) => {
      captured = ctx;
    };
    const pass = (
      fn: (c: MiddlewareContext, n: (c: MiddlewareContext) => Promise<void>) => Promise<void>,
    ) => fn;
    const mws = [
      pass(async (ctx, next) => next(ctx)),
      pass(async (ctx, next) => next(ctx)),
      pass(async (ctx, next) => next(ctx)),
    ];
    await runMiddleware(mws, baseCtx, final);
    expect(captured).toBe(baseCtx);
  });
});
