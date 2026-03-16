import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLongPress } from '~/composables/useLongPress'

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not call callback before duration elapses', () => {
    const cb = vi.fn()
    const { start } = useLongPress()
    start(cb)
    vi.advanceTimersByTime(599)
    expect(cb).not.toHaveBeenCalled()
  })

  it('calls callback after default 600ms', () => {
    const cb = vi.fn()
    const { start } = useLongPress()
    start(cb)
    vi.advanceTimersByTime(600)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('respects custom duration', () => {
    const cb = vi.fn()
    const { start } = useLongPress(1000)
    start(cb)
    vi.advanceTimersByTime(999)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('sets activated to true when fired', () => {
    const cb = vi.fn()
    const { start, activated } = useLongPress()
    expect(activated.value).toBe(false)
    start(cb)
    vi.advanceTimersByTime(600)
    expect(activated.value).toBe(true)
  })

  it('cancel prevents callback from firing', () => {
    const cb = vi.fn()
    const { start, cancel } = useLongPress()
    start(cb)
    vi.advanceTimersByTime(300)
    cancel()
    vi.advanceTimersByTime(600)
    expect(cb).not.toHaveBeenCalled()
  })

  it('resets activated to false on each start()', () => {
    const cb = vi.fn()
    const { start, cancel, activated } = useLongPress()
    start(cb)
    vi.advanceTimersByTime(600)
    expect(activated.value).toBe(true)
    cancel()
    start(vi.fn())
    expect(activated.value).toBe(false)
  })
})
