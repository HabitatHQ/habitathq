/**
 * Gated debug logging for Palladium internals.
 *
 * Zero-cost when disabled: `dbg()` checks a boolean flag and returns
 * immediately. Safe to call from web workers (no DOM APIs used).
 *
 * Enable at runtime via `enableDebug()` — typically gated on
 * `localStorage.getItem('palladium:debug')` or a build-time flag.
 */

/** Custom log handler signature. */
export type LogFn = (scope: string, msg: string, data?: Record<string, unknown>) => void;

let _enabled = false;
let _log: LogFn = () => {};

/** Turn on debug logging, optionally providing a custom log handler. */
export function enableDebug(log?: LogFn): void {
  _enabled = true;
  _log =
    log ??
    ((scope, msg, data) => {
      const parts: unknown[] = [`[${scope}]`, msg];
      if (data) parts.push(JSON.stringify(data));
      // biome-ignore lint/suspicious/noConsole: debug logging intentionally uses console
      console.debug(...parts);
    });
}

/** Turn off debug logging and discard the current handler. */
export function disableDebug(): void {
  _enabled = false;
  _log = () => {};
}

/** Emit a debug message if logging is enabled. No-op otherwise. */
export function dbg(scope: string, msg: string, data?: Record<string, unknown>): void {
  if (_enabled) _log(scope, msg, data);
}

/** Check whether debug logging is currently active. */
export function isDebugEnabled(): boolean {
  return _enabled;
}
