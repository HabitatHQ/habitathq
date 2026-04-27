/**
 * Pure helper functions used by the database worker.
 * Extracted here so they can be unit-tested independently.
 * The worker imports and uses these directly.
 */

export function aggregateIouBalances(
  splits: Array<{
    from_user_id: string
    to_user_id: string
    amount: number
    from_name: string
    from_avatar: string
    to_name: string
    to_avatar: string
  }>,
) {
  const balanceMap = new Map<string, number>()
  const metaMap = new Map<
    string,
    { from_name: string; from_avatar: string; to_name: string; to_avatar: string }
  >()

  for (const s of splits) {
    const key = [s.from_user_id, s.to_user_id].sort().join('|')
    const isForward = s.from_user_id < s.to_user_id
    balanceMap.set(key, (balanceMap.get(key) ?? 0) + (isForward ? s.amount : -s.amount))
    metaMap.set(key, {
      from_name: s.from_name,
      from_avatar: s.from_avatar,
      to_name: s.to_name,
      to_avatar: s.to_avatar,
    })
  }

  return Array.from(balanceMap.entries())
    .filter(([, amt]) => Math.abs(amt) > 0.01)
    .map(([key, netAmount]) => {
      const [uid1, uid2] = key.split('|')
      const meta = metaMap.get(key)!
      return {
        from_user_id: uid1,
        to_user_id: uid2,
        from_user_name: meta.from_name,
        to_user_name: meta.to_name,
        from_user_avatar: meta.from_avatar,
        to_user_avatar: meta.to_avatar,
        net_amount: netAmount,
      }
    })
}
