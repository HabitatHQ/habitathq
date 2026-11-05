import { describe, expect, it } from 'vitest'
import { createSerializedDbDispatcher, aggregateIouBalances } from '~/lib/worker-helpers'

// ── aggregateIouBalances ────────────────────────────────────────────────────

describe('aggregateIouBalances', () => {
  const split = (from: string, to: string, amount: number, fromName = from, toName = to) => ({
    from_user_id: from,
    to_user_id: to,
    amount,
    currency: 'USD',
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

  it('retains an exact cent debt and nets amounts in integer cents', () => {
    const oneCent = aggregateIouBalances([split('a', 'b', 0.01, 'Alice', 'Bob')])
    expect(oneCent).toHaveLength(1)
    expect(oneCent[0]!.net_amount).toBe(0.01)
    const cancelled = aggregateIouBalances([
      split('a', 'b', 0.1),
      split('a', 'b', 0.2),
      split('b', 'a', 0.3),
    ])
    expect(cancelled).toHaveLength(0)
  })

  it('handles three-way splits independently with matching debt metadata', () => {
    const result = aggregateIouBalances([
      split('a', 'b', 30, 'Alice', 'Bob'),
      split('b', 'c', 20, 'Bob', 'Carol'),
      split('c', 'a', 10, 'Carol', 'Alice'),
    ])
    expect(result).toHaveLength(3)
    expect(result.find((r) => r.from_user_id === 'a' && r.to_user_id === 'b')?.net_amount).toBe(30)
    expect(result.find((r) => r.from_user_id === 'b' && r.to_user_id === 'c')?.net_amount).toBe(20)
    expect(result.find((r) => r.from_user_id === 'c' && r.to_user_id === 'a')?.net_amount).toBe(10)
  })

  it('keeps names and avatars aligned when lexical order reverses debt direction', () => {
    const result = aggregateIouBalances([split('z-user', 'a-user', 50, 'Zed', 'Amy')])
    expect(result[0]).toMatchObject({
      from_user_id: 'z-user',
      to_user_id: 'a-user',
      from_user_name: 'Zed',
      to_user_name: 'Amy',
      net_amount: 50,
    })
  })

  it('returns a positive amount with canonical debt orientation for either order', () => {
    const aliceLends = aggregateIouBalances([split('alice', 'bob', 50, 'Alice', 'Bob')])
    expect(aliceLends[0]).toMatchObject({
      from_user_id: 'alice',
      to_user_id: 'bob',
      net_amount: 50,
    })
    const bobLends = aggregateIouBalances([split('bob', 'alice', 50, 'Bob', 'Alice')])
    expect(bobLends[0]).toMatchObject({
      from_user_id: 'bob',
      to_user_id: 'alice',
      net_amount: 50,
    })
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

  it('does not net debts across currencies or classify unknown currency', () => {
    const usd = split('a', 'b', 10)
    const eur = { ...split('b', 'a', 10), currency: 'EUR' }
    const unknown = { ...split('a', 'b', 40), currency: null }
    expect(aggregateIouBalances([usd, eur, unknown])).toMatchObject([
      { from_user_id: 'a', to_user_id: 'b', net_amount: 10, currency: 'USD' },
      { from_user_id: 'b', to_user_id: 'a', net_amount: 10, currency: 'EUR' },
    ])
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
describe('serialized database dispatcher', () => {
  it('does not start a later request while a multi-step request is still pending', async () => {
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const events: string[] = []
    const dispatch = createSerializedDbDispatcher(async (request) => {
      events.push(`start:${request.type}`)
      if (request.type === 'GET_USERS') await firstHeld
      events.push(`end:${request.type}`)
      return null
    })

    const first = dispatch({ type: 'GET_USERS' })
    const second = dispatch({ type: 'GET_CURRENT_USER' })
    await Promise.resolve()
    expect(events).toEqual(['start:GET_USERS'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      'start:GET_USERS',
      'end:GET_USERS',
      'start:GET_CURRENT_USER',
      'end:GET_CURRENT_USER',
    ])
  })

  it('continues serving queued requests after a rejected operation', async () => {
    const dispatch = createSerializedDbDispatcher(async (request) => {
      if (request.type === 'GET_USERS') throw new Error('expected')
      return request.type
    })
    await expect(dispatch({ type: 'GET_USERS' })).rejects.toThrow('expected')
    await expect(dispatch({ type: 'GET_CURRENT_USER' })).resolves.toBe('GET_CURRENT_USER')
  })
})
