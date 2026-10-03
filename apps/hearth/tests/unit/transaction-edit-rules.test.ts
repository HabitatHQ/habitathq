import { describe, expect, it } from 'vitest'
import { getIouSplitEditError, getTransferDestinationError } from '~/lib/transaction-edit-rules'
import type { TransactionType } from '~/types/database'

type SplitSensitiveFields = { type: TransactionType; amount: number; currency: string }

const original: SplitSensitiveFields = { type: 'expense', amount: -42, currency: 'USD' }

function edit(overrides: Partial<SplitSensitiveFields> = {}): SplitSensitiveFields {
  return { ...original, ...overrides }
}

describe('getIouSplitEditError', () => {
  it('allows ordinary transactions to change split-sensitive fields', () => {
    expect(
      getIouSplitEditError(false, original, edit({ type: 'transfer', amount: 42, currency: 'EUR' })),
    ).toBeNull()
  })

  it('allows an IOU-linked expense to keep its split while other fields are edited', () => {
    expect(getIouSplitEditError(true, original, edit())).toBeNull()
  })

  it('rejects changing an IOU-linked transaction type', () => {
    expect(getIouSplitEditError(true, original, edit({ type: 'income' }))).toMatch(/IOU split/)
  })

  it('rejects changing an IOU-linked transaction amount', () => {
    expect(getIouSplitEditError(true, original, edit({ amount: -50 }))).toMatch(/IOU split/)
  })

  it('rejects changing an IOU-linked transaction currency', () => {
    expect(getIouSplitEditError(true, original, edit({ currency: 'EUR' }))).toMatch(/IOU split/)
  })
})

describe('getTransferDestinationError', () => {
  it('requires a destination for transfers', () => {
    expect(getTransferDestinationError('transfer', 'source', '')).toBe(
      'Please select a destination account',
    )
  })

  it('rejects using the source account as its own destination', () => {
    expect(getTransferDestinationError('transfer', 'same', 'same')).toBe(
      'Source and destination accounts must be different',
    )
  })

  it('accepts a distinct transfer destination', () => {
    expect(getTransferDestinationError('transfer', 'source', 'destination')).toBeNull()
  })

  it('does not require a destination for non-transfer transactions', () => {
    expect(getTransferDestinationError('expense', 'source', '')).toBeNull()
  })
})
