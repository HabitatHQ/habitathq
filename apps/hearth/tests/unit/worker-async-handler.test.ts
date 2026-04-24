/**
 * Tests the async message-handler pattern used in database.worker.ts.
 *
 * The bug: handleRequest was declared `function handleRequest(): unknown` (sync)
 * but contained `await poolUtil.removeVfs()` in the NUKE_OPFS case.
 * The fix: make it `async function handleRequest(): Promise<unknown>` and switch
 * the listener to use `.then()` / `.catch()`.
 *
 * These tests verify the *pattern* (no WASM/OPFS dependency needed).
 */
import { describe, expect, it, vi } from 'vitest'

// ── helpers ───────────────────────────────────────────────────────────────────

type WorkerResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }

/**
 * Simulates the FIXED message listener used in database.worker.ts.
 * The handler is async; the listener awaits via .then().
 */
function makeFixedListener(
  handleRequest: (req: { type: string; id: string }) => Promise<unknown>,
  postMessage: (msg: WorkerResponse) => void,
) {
  return (req: { type: string; id: string }) => {
    void handleRequest(req).then(
      (result) => postMessage({ id: req.id, ok: true, data: result }),
      (err: unknown) =>
        postMessage({
          id: req.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
    )
  }
}

/**
 * Simulates the BROKEN pattern (sync handler, no await).
 * Kept here for contrast — shows why the bug caused the error.
 */
function makeBrokenListener(
  handleRequest: (req: { type: string; id: string }) => unknown,
  postMessage: (msg: WorkerResponse) => void,
) {
  return (req: { type: string; id: string }) => {
    try {
      const result = handleRequest(req)
      postMessage({ id: req.id, ok: true, data: result })
    } catch (err) {
      postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ── async handler tests ───────────────────────────────────────────────────────

describe('fixed async worker message handler', () => {
  it('resolves an async handler and posts ok:true', async () => {
    const posts: WorkerResponse[] = []
    const handler = async (_req: { type: string; id: string }) => ({ answer: 42 })
    const listen = makeFixedListener(handler, (msg) => posts.push(msg))

    listen({ type: 'SOMETHING', id: 'req-1' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(1)
    })

    expect(posts[0]).toEqual({ id: 'req-1', ok: true, data: { answer: 42 } })
  })

  it('catches a rejected async handler and posts ok:false', async () => {
    const posts: WorkerResponse[] = []
    const handler = async (_req: { type: string; id: string }) => {
      throw new Error('DB exploded')
    }
    const listen = makeFixedListener(handler, (msg) => posts.push(msg))

    listen({ type: 'SOMETHING', id: 'req-2' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(1)
    })

    expect(posts[0]).toEqual({ id: 'req-2', ok: false, error: 'DB exploded' })
  })

  it('awaits an async NUKE_OPFS-like operation before posting', async () => {
    const order: string[] = []
    const posts: WorkerResponse[] = []

    const handler = async (req: { type: string; id: string }) => {
      if (req.type === 'NUKE_OPFS') {
        order.push('before-await')
        // simulate async removeVfs()
        await new Promise<void>((r) => setTimeout(r, 10))
        order.push('after-await')
        return null
      }
      return 'other'
    }
    const listen = makeFixedListener(handler, (msg) => {
      order.push('posted')
      posts.push(msg)
    })

    listen({ type: 'NUKE_OPFS', id: 'req-3' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(1)
    })

    // postMessage must come AFTER the await resolves
    expect(order).toEqual(['before-await', 'after-await', 'posted'])
    expect(posts[0]).toEqual({ id: 'req-3', ok: true, data: null })
  })

  it('handles multiple concurrent requests independently', async () => {
    const posts: WorkerResponse[] = []
    const handler = async (req: { type: string; id: string }) => {
      await new Promise<void>((r) => setTimeout(r, 0))
      return req.id
    }
    const listen = makeFixedListener(handler, (msg) => posts.push(msg))

    listen({ type: 'A', id: 'slow' })
    listen({ type: 'B', id: 'fast' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(2)
    })

    const ids = posts.map((p) => (p.ok ? p.data : null))
    expect(ids).toContain('slow')
    expect(ids).toContain('fast')
  })

  it('non-Error rejection surfaces as string message', async () => {
    const posts: WorkerResponse[] = []
    const handler = async () => {
      throw 'plain string error'
    }
    const listen = makeFixedListener(handler, (msg) => posts.push(msg))

    listen({ type: 'X', id: 'req-4' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(1)
    })

    expect(posts[0]).toEqual({ id: 'req-4', ok: false, error: 'plain string error' })
  })
})

// ── broken pattern comparison ─────────────────────────────────────────────────

describe('broken sync handler (demonstrates the original bug)', () => {
  it('posts a Promise object instead of the resolved value', () => {
    const posts: WorkerResponse[] = []
    // Sync wrapper over an async handler — this is what the broken code did
    const asyncHandler = async () => ({ answer: 42 })
    const syncWrapper = (_req: { type: string; id: string }) => asyncHandler()
    const listen = makeBrokenListener(syncWrapper, (msg) => posts.push(msg))

    listen({ type: 'SOMETHING', id: 'req-5' })

    // The broken path posts *synchronously* with a Promise as `data`
    expect(posts).toHaveLength(1)
    expect(posts[0].ok).toBe(true)
    if (posts[0].ok) {
      // data is a Promise, not the resolved value — this is the bug
      expect(posts[0].data).toBeInstanceOf(Promise)
    }
  })
})
