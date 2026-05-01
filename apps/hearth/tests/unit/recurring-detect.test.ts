import { describe, expect, it } from 'vitest'
import { detectRecurringPatterns } from '~/lib/recurring/detect'
import { projectNextOccurrence } from '~/lib/recurring/project'
import type { DetectableTransaction } from '~/lib/recurring/types'

// Helper to create transactions at regular intervals
function makeTxns(
  merchant: string,
  amount: number,
  startDaysAgo: number,
  intervalDays: number,
  count: number,
): DetectableTransaction[] {
  const txns: DetectableTransaction[] = []
  for (let i = 0; i < count; i++) {
    const daysAgo = startDaysAgo - i * intervalDays
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    txns.push({
      id: `t-${merchant}-${i}`,
      date: date.toISOString().slice(0, 10),
      amount: -amount,
      type: 'expense',
      merchant,
      category_id: 'c1',
      account_id: 'a1',
    })
  }
  return txns
}

describe('detectRecurringPatterns', () => {
  it('detects monthly pattern with 3+ transactions at ~30 day intervals', () => {
    const txns = makeTxns('Netflix', 15.99, 90, 30, 4) // 4 months of Netflix
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.interval).toBe('monthly')
    expect(patterns[0]!.merchant).toBe('Netflix')
    expect(patterns[0]!.averageAmount).toBeCloseTo(15.99)
  })

  it('detects biweekly pattern (paychecks every 14 days)', () => {
    const txns = makeTxns('ACME Corp', -3000, 84, 14, 7) // income, positive
    // Override type to income
    for (const t of txns) {
      t.amount = 3000
      t.type = 'income'
    }
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.interval).toBe('biweekly')
  })

  it('detects weekly pattern', () => {
    const txns = makeTxns('Gym', 10, 42, 7, 7) // 7 weeks
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.interval).toBe('weekly')
  })

  it('skips merchants with fewer than 3 transactions', () => {
    const txns = makeTxns('OncePlace', 50, 30, 30, 2) // only 2
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(0)
  })

  it('does NOT detect irregular intervals as recurring', () => {
    const txns: DetectableTransaction[] = [
      {
        id: 't1',
        date: '2026-01-05',
        amount: -30,
        type: 'expense',
        merchant: 'Random Shop',
        category_id: 'c1',
        account_id: 'a1',
      },
      {
        id: 't2',
        date: '2026-02-20',
        amount: -45,
        type: 'expense',
        merchant: 'Random Shop',
        category_id: 'c1',
        account_id: 'a1',
      },
      {
        id: 't3',
        date: '2026-03-02',
        amount: -25,
        type: 'expense',
        merchant: 'Random Shop',
        category_id: 'c1',
        account_id: 'a1',
      },
      {
        id: 't4',
        date: '2026-04-15',
        amount: -60,
        type: 'expense',
        merchant: 'Random Shop',
        category_id: 'c1',
        account_id: 'a1',
      },
    ]
    const patterns = detectRecurringPatterns(txns, [])
    // Amounts vary too much (>15%) AND intervals are irregular
    expect(patterns.length).toBe(0)
  })

  it('rejects amount variation beyond 15%', () => {
    const txns: DetectableTransaction[] = [
      {
        id: 't1',
        date: '2026-01-01',
        amount: -10,
        type: 'expense',
        merchant: 'VaryShop',
        category_id: 'c1',
        account_id: 'a1',
      },
      {
        id: 't2',
        date: '2026-02-01',
        amount: -50,
        type: 'expense',
        merchant: 'VaryShop',
        category_id: 'c1',
        account_id: 'a1',
      },
      {
        id: 't3',
        date: '2026-03-01',
        amount: -10,
        type: 'expense',
        merchant: 'VaryShop',
        category_id: 'c1',
        account_id: 'a1',
      },
    ]
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(0)
  })

  it('accepts small amount variation (within 15%)', () => {
    // Use recent dates so recency bonus is high enough
    const txns = makeTxns('Spotify', 10.5, 60, 30, 3)
    // Vary the amounts slightly
    txns[0]!.amount = -10.0
    txns[1]!.amount = -10.5
    txns[2]!.amount = -10.99
    const patterns = detectRecurringPatterns(txns, [])
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.interval).toBe('monthly')
  })

  it('assigns higher confidence to patterns with 5+ occurrences', () => {
    const txns3 = makeTxns('Service3', 20, 90, 30, 3)
    const txns6 = makeTxns('Service6', 20, 180, 30, 6)
    const patterns = detectRecurringPatterns([...txns3, ...txns6], [])
    const p3 = patterns.find((p) => p.merchant === 'Service3')
    const p6 = patterns.find((p) => p.merchant === 'Service6')
    expect(p6!.confidence).toBeGreaterThan(p3!.confidence)
  })

  it('excludes patterns already in existingPatterns', () => {
    const txns = makeTxns('Netflix', 15.99, 90, 30, 4)
    const existing = [
      {
        id: 'existing-1',
        merchant: 'Netflix',
        type: 'expense' as const,
        interval: 'monthly' as const,
        averageAmount: 15.99,
        lastOccurrence: '2026-01-01',
        nextExpected: '2026-02-01',
        confidence: 0.9,
        status: 'confirmed' as const,
        categoryId: null,
        accountId: null,
        transactionIds: [],
      },
    ]
    const patterns = detectRecurringPatterns(txns, existing)
    expect(patterns.length).toBe(0) // already tracked
  })
})

describe('projectNextOccurrence', () => {
  it('projects weekly: +7 days', () => {
    expect(projectNextOccurrence('2026-04-01', 'weekly')).toBe('2026-04-08')
  })

  it('projects biweekly: +14 days', () => {
    expect(projectNextOccurrence('2026-04-01', 'biweekly')).toBe('2026-04-15')
  })

  it('projects monthly: same day next month', () => {
    expect(projectNextOccurrence('2026-04-15', 'monthly')).toBe('2026-05-15')
  })

  it('projects monthly: clamps to end of month (Jan 31 → Feb 28)', () => {
    expect(projectNextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28')
  })

  it('projects quarterly: +3 months', () => {
    expect(projectNextOccurrence('2026-01-15', 'quarterly')).toBe('2026-04-15')
  })

  it('projects annual: +1 year', () => {
    expect(projectNextOccurrence('2026-04-01', 'annual')).toBe('2027-04-01')
  })
})
