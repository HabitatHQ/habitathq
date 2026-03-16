import { describe, it, expect, vi, afterEach } from 'vitest'
import { logError } from '~/utils/error'

describe('logError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the error message for an Error instance', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(logError('myScope', new Error('boom'))).toBe('boom')
  })

  it('returns String(err) for a non-Error value', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(logError('myScope', 'a string error')).toBe('a string error')
    expect(logError('myScope', 42)).toBe('42')
  })

  it('calls console.error with the scope prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('saveHabit', new Error('oops'))
    expect(spy).toHaveBeenCalledWith('[saveHabit]', 'oops')
  })

  it('handles null and undefined gracefully', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(logError('scope', null)).toBe('null')
    expect(logError('scope', undefined)).toBe('undefined')
  })
})
