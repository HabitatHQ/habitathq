import { projectNextOccurrence } from './project'
import type { DetectableTransaction, RecurringInterval, RecurringPattern } from './types'

interface IntervalSpec {
  name: RecurringInterval
  minDays: number
  maxDays: number
  maxStddev: number
}

const INTERVALS: IntervalSpec[] = [
  { name: 'weekly', minDays: 5, maxDays: 9, maxStddev: 3 },
  { name: 'biweekly', minDays: 12, maxDays: 16, maxStddev: 4 },
  { name: 'monthly', minDays: 26, maxDays: 34, maxStddev: 5 },
  { name: 'quarterly', minDays: 80, maxDays: 100, maxStddev: 10 },
  { name: 'annual', minDays: 340, maxDays: 390, maxStddev: 20 },
]

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

function stddev(values: number[]): number {
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000
  return Math.abs(parseLocalDate(a).getTime() - parseLocalDate(b).getTime()) / msPerDay
}

/**
 * Detect recurring patterns from transaction history.
 * Pure function — no side effects, fully testable.
 */
export function detectRecurringPatterns(
  transactions: DetectableTransaction[],
  existingPatterns: RecurringPattern[],
): RecurringPattern[] {
  // Group by (merchant, type)
  const groups = new Map<string, DetectableTransaction[]>()
  for (const t of transactions) {
    const key = `${t.merchant.toLowerCase().trim()}|${t.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  // Track existing patterns to skip
  const existingKeys = new Set(
    existingPatterns.map((p) => `${p.merchant.toLowerCase().trim()}|${p.type}`),
  )

  const patterns: RecurringPattern[] = []

  for (const [key, txns] of groups) {
    if (existingKeys.has(key)) continue
    if (txns.length < 3) continue

    // Sort by date ascending
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date))

    // Calculate intervals between consecutive transactions
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1]!.date, sorted[i]!.date))
    }

    const meanInterval = mean(intervals)
    const stddevInterval = stddev(intervals)

    // Check amount consistency
    const amounts = sorted.map((t) => Math.abs(t.amount))
    const meanAmount = mean(amounts)
    const stddevAmount = stddev(amounts)
    const amountVariation = meanAmount > 0 ? stddevAmount / meanAmount : 1

    if (amountVariation > 0.15) continue // amounts vary too much

    // Try to match an interval
    let matchedInterval: IntervalSpec | null = null
    for (const spec of INTERVALS) {
      if (
        meanInterval >= spec.minDays &&
        meanInterval <= spec.maxDays &&
        stddevInterval <= spec.maxStddev
      ) {
        matchedInterval = spec
        break
      }
    }

    if (!matchedInterval) continue

    // Calculate confidence
    const baseScore = sorted.length >= 5 ? 0.9 : sorted.length >= 4 ? 0.7 : 0.5

    const lastOccurrence = sorted[sorted.length - 1]!.date
    const expectedIntervalDays = meanInterval
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const daysSinceLast = daysBetween(lastOccurrence, todayStr)
    const recencyBonus =
      daysSinceLast <= expectedIntervalDays * 1.5
        ? 1.0
        : daysSinceLast <= expectedIntervalDays * 2.5
          ? 0.8
          : 0.5

    const consistencyBonus = amountVariation < 0.05 ? 1.0 : amountVariation < 0.1 ? 0.9 : 0.8

    const confidence = baseScore * recencyBonus * consistencyBonus
    if (confidence < 0.5) continue

    const nextExpected = projectNextOccurrence(lastOccurrence, matchedInterval.name)

    patterns.push({
      id: `rp-${Date.now()}-${patterns.length}`,
      merchant: sorted[0]!.merchant,
      type: sorted[0]!.type,
      interval: matchedInterval.name,
      averageAmount: Math.round(meanAmount * 100) / 100,
      lastOccurrence,
      nextExpected,
      confidence: Math.round(confidence * 100) / 100,
      status: 'detected',
      categoryId: sorted[0]!.category_id,
      accountId: sorted[0]!.account_id,
      transactionIds: sorted.map((t) => t.id),
    })
  }

  return patterns.sort((a, b) => b.confidence - a.confidence)
}
