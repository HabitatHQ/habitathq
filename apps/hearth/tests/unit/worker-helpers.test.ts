import { describe, expect, it } from 'vitest'
import { aggregateIouBalances } from '~/lib/worker-helpers'

// ── aggregateIouBalances ────────────────────────────────────────────────────

describe('aggregateIouBalances', () => {
  const split = (from: string, to: string, amount: number, fromName = from, toName = to) => ({
    from_user_id: from,
    to_user_id: to,
    amount,
    from_name: fromName,
    from_avatar: `${fromName[0]}`,
    to_name: toName,
    to_avatar: `${toName[0]}`,
  })

  it('returns empty array for no splits', () => {
    expect(aggregateIouBalances([])).toEqual([])
  })

  it('returns single balance for one split', () => {
    const result = aggregateIouBalances([split('a', 'b', 50, 'Alice', 'Bob')])
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBe(50)
    expect(result[0]!.from_user_id).toBe('a')
    expect(result[0]!.to_user_id).toBe('b')
  })

  it('aggregates multiple splits in the same direction', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 20, 'Alice', 'Bob'),
      split('a', 'b', 30, 'Alice', 'Bob'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBe(50)
  })

  it('nets out opposing splits between same pair', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 50, 'Alice', 'Bob'),
      split('b', 'a', 30, 'Bob', 'Alice'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBe(20)
  })

  it('fully cancelling splits produces empty result', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 50, 'Alice', 'Bob'),
      split('b', 'a', 50, 'Bob', 'Alice'),
    ])
    expect(result).toHaveLength(0)
  })

  it('filters out sub-penny balances (< $0.01)', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 50, 'Alice', 'Bob'),
      split('b', 'a', 49.998, 'Bob', 'Alice'),
    ])
    // Net is $0.002 which is < $0.01 threshold
    expect(result).toHaveLength(0)
  })

  it('keeps balance at exactly the threshold', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 50, 'Alice', 'Bob'),
      split('b', 'a', 49.98, 'Bob', 'Alice'),
    ])
    // Net is $0.02 which is > $0.01
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBeCloseTo(0.02, 2)
  })

  it('handles three-way splits independently', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 30, 'Alice', 'Bob'),
      split('b', 'c', 20, 'Bob', 'Carol'),
      split('c', 'a', 10, 'Carol', 'Alice'),
    ])
    expect(result).toHaveLength(3)
    const ab = result.find((r) => r.from_user_id === 'a' && r.to_user_id === 'b')
    const bc = result.find((r) => r.from_user_id === 'b' && r.to_user_id === 'c')
    const ac = result.find((r) => r.from_user_id === 'a' && r.to_user_id === 'c')
    expect(ab!.net_amount).toBe(30)
    expect(bc!.net_amount).toBe(20)
    expect(ac!.net_amount).toBe(-10)
  })

  it('user ID ordering is deterministic regardless of split order', () => {
    const forward = aggregateIouBalances([split('bob', 'alice', 50, 'Bob', 'Alice')])
    const reverse = aggregateIouBalances([split('alice', 'bob', 50, 'Alice', 'Bob')])

    // Both should have alice|bob as the key (sorted)
    expect(forward[0]!.from_user_id).toBe('alice')
    expect(forward[0]!.to_user_id).toBe('bob')
    expect(reverse[0]!.from_user_id).toBe('alice')
    expect(reverse[0]!.to_user_id).toBe('bob')
  })

  it('net_amount sign indicates direction correctly', () => {
    // alice < bob lexicographically, so alice is "from" in the key
    // If alice lent to bob (split from alice → bob), net should be positive
    const result = aggregateIouBalances([split('alice', 'bob', 50, 'Alice', 'Bob')])
    expect(result[0]!.net_amount).toBe(50) // positive = bob owes alice

    // If bob lent to alice, net should be negative
    const result2 = aggregateIouBalances([split('bob', 'alice', 50, 'Bob', 'Alice')])
    expect(result2[0]!.net_amount).toBe(-50) // negative = alice owes bob
  })

  it('preserves name/avatar metadata from splits', () => {
    const result = aggregateIouBalances([split('u1', 'u2', 10, 'Alex', 'Sam')])
    expect(result[0]!.from_user_name).toBe('Alex')
    expect(result[0]!.to_user_name).toBe('Sam')
    expect(result[0]!.from_user_avatar).toBe('A')
    expect(result[0]!.to_user_avatar).toBe('S')
  })

  it('handles many small splits accumulating to a meaningful total', () => {
    const splits = Array.from({ length: 100 }, () => split('a', 'b', 0.1, 'A', 'B'))
    const result = aggregateIouBalances(splits)
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBeCloseTo(10, 1)
  })

  it('handles negative amounts in splits', () => {
    const result = aggregateIouBalances([split('a', 'b', -20, 'A', 'B')])
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBe(-20)
  })

  it('seed data scenario: two opposing IOUs net correctly', () => {
    // Matches the actual seed data: iou1 u1→u2 $43.72, iou2 u2→u1 $31.60
    const result = aggregateIouBalances([
      split('u1', 'u2', 43.72, 'Alex', 'Sam'),
      split('u2', 'u1', 31.6, 'Sam', 'Alex'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.net_amount).toBeCloseTo(12.12, 2)
    expect(result[0]!.from_user_id).toBe('u1')
    expect(result[0]!.to_user_id).toBe('u2')
  })
})
