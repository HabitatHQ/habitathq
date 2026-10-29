/**
 * Minimal, typed EventEmitter used throughout @palladium/core.
 *
 * The generic `Events` map associates event names with their payload types.
 * `undefined` payload events (e.g. `done: undefined`) receive no argument.
 */

type Listener<T> = T extends undefined ? () => void : (payload: T) => void;

type ListenerMap<Events extends object> = {
  [K in keyof Events]?: Set<Listener<Events[K]>>;
};

export class EventEmitter<Events extends object> {
  readonly #listeners: ListenerMap<Events> = {};

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    if (this.#listeners[event] === undefined) {
      this.#listeners[event] = new Set();
    }
    this.#listeners[event].add(listener);
    return () => this.off(event, listener);
  }

  /** Subscribe to an event exactly once. Returns an unsubscribe function to cancel before it fires. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapped = ((payload: Events[K]) => {
      this.off(event, wrapped as Listener<Events[K]>);
      return (listener as (p: Events[K]) => unknown)(payload);
    }) as Listener<Events[K]>;
    return this.on(event, wrapped);
  }

  /** Remove a specific listener for an event. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.#listeners[event]?.delete(listener);
  }

  /** Emit an event, calling all registered listeners. */
  emit<K extends keyof Events>(
    ...args: Events[K] extends undefined ? [event: K] : [event: K, payload: Events[K]]
  ): void {
    const [event, payload] = args;
    const listeners = this.#listeners[event];
    if (listeners === undefined) return;
    // Iterate a snapshot, not the live Set: a listener that subscribes a new
    // listener during dispatch must not have that new listener invoked within
    // this same dispatch. Unsubscription during dispatch must still take
    // effect immediately, so each snapshotted listener is checked against the
    // live Set right before it's called rather than skipped via the snapshot.
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      (listener as (p: Events[K]) => void)(payload as Events[K]);
    }
  }

  /** Own callback rejection without awaiting potentially reentrant observer work. */
  emitObserved<K extends keyof Events>(
    onError: (error: unknown) => void,
    ...args: Events[K] extends undefined ? [event: K] : [event: K, payload: Events[K]]
  ): void {
    const [event, payload] = args;
    const report = (error: unknown): void => {
      try {
        void Promise.resolve(onError(error)).catch(() => undefined);
      } catch {
        // A failure sink cannot safely report its own failure recursively.
      }
    };
    const listeners = this.#listeners[event];
    // See `emit`'s snapshot comment: dispatch over a copy so a listener
    // subscribed mid-dispatch waits for the next emit, while a listener
    // unsubscribed mid-dispatch is still honoured immediately.
    for (const listener of listeners === undefined ? [] : [...listeners]) {
      if (!listeners?.has(listener)) continue;
      try {
        const result = (listener as (p: Events[K]) => unknown)(payload as Events[K]);
        void Promise.resolve(result).catch(report);
      } catch (error) {
        report(error);
      }
    }
  }

  /** Remove all listeners for an event (or all events if no event given). */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event === undefined) {
      for (const key of Object.keys(this.#listeners) as K[]) {
        delete this.#listeners[key];
      }
    } else {
      delete this.#listeners[event];
    }
  }
}
