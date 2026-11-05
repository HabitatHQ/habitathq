/**
 * Pure helper functions used by the database worker.
 * Extracted here so they can be unit-tested independently.
 * The worker imports and uses these directly.
 */

import type { WorkerRequestBody } from '~/types/database'

export function createSerializedDbDispatcher(
  dispatch: (request: WorkerRequestBody) => Promise<unknown>,
) {
  let queue = Promise.resolve()
  return (request: WorkerRequestBody): Promise<unknown> => {
    const result = queue.then(() => dispatch(request))
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export function aggregateIouBalances(
  splits: Array<{
    from_user_id: string
    to_user_id: string
    amount: number
    currency: string | null
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>,
) {
  const balances = new Map<
    string,
    {
      amountCents: number
      currency: string
      from_user_id: string
      to_user_id: string
      from_name: string
      from_avatar: string
      to_name: string
      to_avatar: string
    }
  >()

  for (const split of splits) {
    if (!split.currency) continue
    const firstId = split.from_user_id < split.to_user_id ? split.from_user_id : split.to_user_id
    const secondId = split.from_user_id < split.to_user_id ? split.to_user_id : split.from_user_id
    const key = `${firstId}\u0000${secondId}\u0000${split.currency}`
    const amountCents = Math.round(split.amount * 100) * (split.from_user_id === firstId ? 1 : -1)
    const previous = balances.get(key)
    if (previous) {
      previous.amountCents += amountCents
    } else {
      balances.set(key, {
        amountCents,
        currency: split.currency,
        from_user_id: firstId,
        to_user_id: secondId,
        from_name: split.from_user_id === firstId ? split.from_name : split.to_name,
        from_avatar: split.from_user_id === firstId ? split.from_avatar : split.to_avatar,
        to_name: split.from_user_id === firstId ? split.to_name : split.from_name,
        to_avatar: split.from_user_id === firstId ? split.to_avatar : split.from_avatar,
      })
    }
  }

  return Array.from(balances.values())
    .filter(({ amountCents }) => amountCents !== 0)
    .map((balance) => {
      const firstOwesSecond = balance.amountCents < 0
      return {
        from_user_id: firstOwesSecond ? balance.to_user_id : balance.from_user_id,
        to_user_id: firstOwesSecond ? balance.from_user_id : balance.to_user_id,
        from_user_name: firstOwesSecond ? balance.to_name : balance.from_name,
        to_user_name: firstOwesSecond ? balance.from_name : balance.to_name,
        from_user_avatar: firstOwesSecond ? balance.to_avatar : balance.from_avatar,
        to_user_avatar: firstOwesSecond ? balance.from_avatar : balance.to_avatar,
        net_amount: Math.abs(balance.amountCents) / 100,
        currency: balance.currency,
      }
    })
}
