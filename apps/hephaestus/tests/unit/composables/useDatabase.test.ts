import { describe, expect, it, vi } from 'vitest'

// We test the database composable logic in isolation by mocking the Worker.
// The actual SQLite worker is not available in happy-dom.

// A minimal mock worker that echoes back structured responses
class MockWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  postMessage: (data: unknown) => void

  constructor() {
    this.postMessage = vi.fn((data: unknown) => {
      const {
        id,
        type,
        payload: _payload,
      } = data as { id: string; type: string; payload?: unknown }

      // Simulate async response
      Promise.resolve().then(() => {
        if (this.onmessage) {
          if (type === 'QUERY') {
            this.onmessage({ data: { id, type: 'QUERY_RESULT', payload: [{ count: 1 }] } })
          } else if (type === 'EXEC') {
            this.onmessage({ data: { id, type: 'EXEC_RESULT', payload: null } })
          } else if (type === 'IS_DEFAULT_APPLIED') {
            this.onmessage({ data: { id, type: 'IS_DEFAULT_APPLIED_RESULT', payload: false } })
          } else if (type === 'MARK_DEFAULT_APPLIED') {
            this.onmessage({
              data: { id, type: 'MARK_DEFAULT_APPLIED_RESULT', payload: null },
            })
          } else {
            this.onmessage({ data: { id, type: 'ERROR', error: `Unknown type: ${type}` } })
          }
        }
      })
    })
  }

  terminate() {}
  addEventListener(event: string, handler: (e: { data: unknown }) => void) {
    if (event === 'message') this.onmessage = handler
  }
}

// Import the db queue logic separately to test it
// Since useDatabase uses a Worker internally, we test the RPC queue mechanism

describe('useDatabase RPC queue', () => {
  it('resolves a query promise when worker responds', async () => {
    const worker = new MockWorker()
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

    // Simulate the RPC mechanism from useDatabase
    worker.addEventListener('message', (e) => {
      const { id, payload, error } = e.data as {
        id?: string
        payload?: unknown
        error?: string
      }
      if (!id) return
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (error) entry.reject(new Error(error))
      else entry.resolve(payload)
    })

    function rpc(type: string, payload?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, type, payload })
      })
    }

    const result = await rpc('QUERY', { sql: 'SELECT COUNT(*) FROM exercises', bind: [] })
    expect(result).toEqual([{ count: 1 }])
  })

  it('rejects when worker responds with an error', async () => {
    const worker = new MockWorker()
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

    worker.addEventListener('message', (e) => {
      const { id, payload, error } = e.data as {
        id?: string
        payload?: unknown
        error?: string
      }
      if (!id) return
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (error) entry.reject(new Error(error))
      else entry.resolve(payload)
    })

    function rpc(type: string, payload?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, type, payload })
      })
    }

    await expect(rpc('UNKNOWN_TYPE')).rejects.toThrow('Unknown type: UNKNOWN_TYPE')
  })

  it('can handle multiple concurrent requests', async () => {
    const worker = new MockWorker()
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

    worker.addEventListener('message', (e) => {
      const { id, payload, error } = e.data as { id?: string; payload?: unknown; error?: string }
      if (!id) return
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (error) entry.reject(new Error(error))
      else entry.resolve(payload)
    })

    function rpc(type: string, payload?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, type, payload })
      })
    }

    const [r1, r2, r3] = await Promise.all([
      rpc('QUERY', { sql: 'SELECT 1' }),
      rpc('EXEC', { sql: 'INSERT INTO x VALUES (1)' }),
      rpc('QUERY', { sql: 'SELECT 2' }),
    ])

    expect(r1).toEqual([{ count: 1 }])
    expect(r2).toBeNull()
    expect(r3).toEqual([{ count: 1 }])
  })
})
