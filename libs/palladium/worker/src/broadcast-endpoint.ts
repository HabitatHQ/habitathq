/**
 * A Comlink {@link Endpoint} tunnelled over a shared BroadcastChannel.
 *
 * BroadcastChannel is a *broadcast* medium: every message reaches every peer,
 * and — unlike MessagePort/Worker — it **cannot transfer objects** (no
 * `MessagePort` handoff). Comlink normally relies on both point-to-point
 * delivery and transfer.
 *
 * We recover point-to-point delivery by wrapping every Comlink frame in an
 * envelope carrying `{from,to}` and only surfacing frames addressed to us from
 * the expected peer. Transfer is simply never used: this endpoint carries only
 * plain-data calls (SQL strings, param arrays, row arrays), so Comlink's
 * transfer list is always empty. Passing a `Comlink.proxy` / callback across
 * this endpoint is unsupported by design — invalidation fan-out uses raw
 * control messages instead (see `db-owner.ts`).
 */

import type { Endpoint } from "comlink";

/** Envelope wrapping a Comlink frame with routing metadata. */
interface RpcEnvelope {
  readonly __rpc: true;
  readonly from: string;
  readonly to: string;
  readonly data: unknown;
}

function isRpcEnvelope(data: unknown): data is RpcEnvelope {
  return typeof data === "object" && data !== null && "__rpc" in data;
}

/**
 * Build a Comlink endpoint that talks to exactly one `peer` as `self` over the
 * given channel. Only frames `{from: peer, to: self}` are delivered upward.
 */
export function makeBroadcastEndpoint(
  channel: BroadcastChannel,
  self: string,
  peer: string,
): Endpoint {
  // Map Comlink's EventListener wrappers to the raw BroadcastChannel listeners
  // so removeEventListener can find them again.
  const wrappers = new Map<EventListenerOrEventListenerObject, (ev: MessageEvent) => void>();

  return {
    postMessage(message: unknown): void {
      const envelope: RpcEnvelope = { __rpc: true, from: self, to: peer, data: message };
      channel.postMessage(envelope);
    },
    addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
      const wrapper = (ev: MessageEvent): void => {
        const env = ev.data;
        if (!isRpcEnvelope(env) || env.to !== self || env.from !== peer) return;
        // Re-present the inner Comlink frame as a normal MessageEvent.
        const inner = new MessageEvent("message", { data: env.data });
        if (typeof listener === "function") listener(inner);
        else listener.handleEvent(inner);
      };
      wrappers.set(listener, wrapper);
      channel.addEventListener("message", wrapper);
    },
    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
      const wrapper = wrappers.get(listener);
      if (!wrapper) return;
      channel.removeEventListener("message", wrapper);
      wrappers.delete(listener);
    },
  };
}
