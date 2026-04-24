import { beforeEach } from 'vitest'

// happy-dom's localStorage lacks .clear() — polyfill with a Map-backed store
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

const memStorage = new MemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  value: memStorage,
  writable: true,
})

// Reset storage between every test so state doesn't bleed
beforeEach(() => {
  memStorage.clear()
})
