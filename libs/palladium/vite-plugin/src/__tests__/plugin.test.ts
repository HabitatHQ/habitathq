import { describe, expect, it } from "vitest";
import { palladium } from "../index.js";

type MiddlewareFn = (
  req: unknown,
  res: { setHeader: (k: string, v: string) => void },
  next: () => void,
) => void;

function runMiddleware(plugin: ReturnType<typeof palladium>): Record<string, string> {
  const headers: Record<string, string> = {};
  const fakeServer = {
    middlewares: {
      use: (fn: MiddlewareFn) => {
        fn(
          {},
          {
            setHeader: (k, v) => {
              headers[k] = v;
            },
          },
          () => {},
        );
      },
    },
  };
  if (typeof plugin.configureServer === "function") {
    plugin.configureServer(fakeServer as never);
  }
  return headers;
}

describe("palladium vite plugin", () => {
  it("has the correct plugin name", () => {
    expect(palladium().name).toBe("palladium");
  });

  it("sets COOP and COEP headers", () => {
    const headers = runMiddleware(palladium());
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });

  it("does not restrict apply phase", () => {
    expect(palladium().apply).toBeUndefined();
  });
});
