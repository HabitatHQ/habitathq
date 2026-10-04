import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@palladium/core', () => ({
  applySchema: vi.fn(),
  dbg: vi.fn(),
  toDbAdapter: vi.fn(() => ({})),
}))
vi.mock('@palladium/sqlite-browser', () => ({
  BrowserSqliteAdapter: class {
    async open() {}
    async exec() {}
    serialize() {
      return new Uint8Array()
    }
  },
}))
vi.mock('~/lib/db-schema', () => ({ SCHEMA_CONFIG: {} }))
vi.mock('~/lib/db-shared', () => ({ dispatch: vi.fn() }))

type Entry = { kind: 'directory'; children: Map<string, Entry> } | { kind: 'file' }

describe('database worker OPFS reset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('removes Hearth storage while preserving sibling app data', async () => {
    const hearthFile: Entry = { kind: 'file' }
    const siblingFile: Entry = { kind: 'file' }
    const entries = new Map<string, Entry>()
    entries.set('hearth', {
      kind: 'directory',
      children: new Map([['hearth.db', hearthFile]]),
    })
    entries.set('habitat', {
      kind: 'directory',
      children: new Map([['habitat.db', siblingFile]]),
    })
    const removeEntry = vi.fn(async (name: string, options?: { recursive?: boolean }) => {
      const entry = entries.get(name)
      if (!entry) throw new DOMException('Not found', 'NotFoundError')
      if (entry.kind === 'directory' && entry.children.size > 0 && !options?.recursive) {
        throw new DOMException('Directory not empty', 'InvalidModificationError')
      }
      entries.delete(name)
    })
    const listeners: EventListener[] = []
    const posts: unknown[] = []
    const storageRoot = { removeEntry }

    vi.stubGlobal('navigator', {
      storage: { getDirectory: async () => storageRoot },
      locks: {
        request: (_name: string, _options: unknown, callback: (lock: object) => unknown) => {
          void callback({})
          return Promise.resolve()
        },
      },
    })
    vi.stubGlobal('self', {
      addEventListener: (_type: string, listener: EventListener) => listeners.push(listener),
      postMessage: (message: unknown) => posts.push(message),
    })

    // Importing the worker is necessary to exercise its actual OPFS reset helper;
    // its worker-global startup dependencies are isolated with the module mocks above.
    const { OPFS_DIR, removeHearthOpfs } = await import('~/workers/database.worker')
    await removeHearthOpfs()

    expect(OPFS_DIR).toBe('hearth')
    expect(removeEntry).toHaveBeenCalledOnce()
    expect(removeEntry).toHaveBeenCalledWith('hearth', { recursive: true })
    expect(entries.has('hearth')).toBe(false)
    expect(entries.get('habitat')).toEqual({
      kind: 'directory',
      children: new Map([['habitat.db', siblingFile]]),
    })
    expect(listeners).toHaveLength(1)
    expect(posts).toContainEqual({ type: 'READY' })
  })
})
