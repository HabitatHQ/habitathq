export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ReadStoredSettingsOptions<T extends object> {
  storage?: SettingsStorage
  defaults: () => T
  normalize?: (stored: Record<string, unknown>, defaults: T, raw: string | null) => T
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one settings record and apply app-owned normalization over fresh defaults. */
export function readStoredSettings<T extends object>(
  key: string,
  options: ReadStoredSettingsOptions<T>,
): T {
  const defaults = options.defaults()
  let stored: Record<string, unknown> = {}
  let raw: string | null = null

  try {
    const source =
      options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    raw = source?.getItem(key) ?? null
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (!isSettingsRecord(parsed)) return defaults
      stored = parsed
    }
  } catch {
    return defaults
  }

  return options.normalize ? options.normalize(stored, defaults, raw) : { ...defaults, ...stored }
}

/** Persist a complete settings record; write failures intentionally propagate. */
export function writeStoredSettings<T>(key: string, value: T, storage?: SettingsStorage): void {
  const source = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  source?.setItem(key, JSON.stringify(value))
}
