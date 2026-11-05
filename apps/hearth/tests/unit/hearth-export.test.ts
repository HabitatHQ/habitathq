import { describe, expect, it } from 'vitest'
import { isHearthExport, parseHearthExport } from '~/lib/hearth-export'

const backup = {
  version: '1.0',
  exported_at: '2026-01-01T00:00:00.000Z',
  users: [{
    id: 'user-1',
    name: 'Me',
    email: null,
    role: 'owner',
    avatar_emoji: '🏠',
    color: '#000',
    is_current: 1,
    created_at: '2026-01-01',
  }],
  accounts: [{
    id: 'checking',
    user_id: 'user-1',
    name: 'Checking',
    type: 'checking',
    balance: 500,
    currency: 'USD',
    color: '#000',
    icon: 'wallet',
    is_active: 1,
    created_at: '2026-01-01',
  }],
  categories: [],
  transactions: [],
  envelopes: [],
  envelope_periods: [],
  iou_splits: [],
  savings_goals: [],
  chores: [],
}
describe('Hearth JSON export validation', () => {
  it('accepts a valid version-one export and an account without legacy opening balance', () => {
    expect(isHearthExport(backup)).toBe(true)
    expect(parseHearthExport(backup)).toEqual(backup)
  })

  it('validates any present extension collection on a version-one export', () => {
    expect(isHearthExport({ ...backup, receipt_images: [] })).toBe(true)
    expect(isHearthExport({ ...backup, exchange_rates: [{ base: 'USD' }] })).toBe(false)
    expect(isHearthExport({ ...backup, chore_completions: {} })).toBe(false)
  })

  it('still requires every extension collection on a version-two export', () => {
    expect(isHearthExport({ ...backup, version: '2.0' })).toBe(false)
  })

  it('rejects malformed records and unsupported versions before import', () => {
    const malformed = { ...backup, transactions: [{ id: 'tx', amount: 'not-a-number' }] }
    expect(isHearthExport(malformed)).toBe(false)
    expect(() => parseHearthExport(malformed)).toThrow()
    expect(() => parseHearthExport({ ...backup, version: '3.0' })).toThrow()
  })
})
