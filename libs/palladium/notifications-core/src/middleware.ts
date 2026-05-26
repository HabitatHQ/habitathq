import type { ChannelName, Notification } from "./types.js";

export type MiddlewareContext = Readonly<{
  notification: Notification;
  channels: ReadonlyArray<ChannelName>;
}>;

export type MiddlewareNext = (ctx: MiddlewareContext) => Promise<void>;

export type Middleware = (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<void>;

export async function runMiddleware(
  middlewares: ReadonlyArray<Middleware>,
  ctx: MiddlewareContext,
  final: MiddlewareNext,
): Promise<void> {
  const dispatch = async (index: number, currentCtx: MiddlewareContext): Promise<void> => {
    if (index >= middlewares.length) {
      await final(currentCtx);
      return;
    }
    const mw = middlewares[index];
    if (mw === undefined) {
      await final(currentCtx);
      return;
    }
    await mw(currentCtx, (nextCtx) => dispatch(index + 1, nextCtx));
  };
  await dispatch(0, ctx);
}
