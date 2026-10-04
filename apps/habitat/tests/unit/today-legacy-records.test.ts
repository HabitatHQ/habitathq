import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTodayRowsWithLegacyUtcKeys,
  legacyUtcKeysForLocalDay,
  mergeTodayIntoHistory,
} from '~/utils/today-legacy-records'

afterEach(() => vi.unstubAllEnvs())

describe('legacy UTC keys on Today', () => {
  it('includes only adjacent UTC-key records captured on the local day', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const local = { id: 'local', date: '2026-10-03', completed_at: '2026-10-04T01:00:00Z' }
    const legacy = { id: 'legacy', date: '2026-10-04', completed_at: '2026-10-04T02:30:00Z' }
    const earlier = { id: 'earlier', date: '2026-10-04', completed_at: '2026-10-03T02:30:00Z' }
    const getForDate = vi.fn(async (date: string) =>
      date === '2026-10-03' ? [local] : [legacy, earlier],
    )

    const legacyKeys = legacyUtcKeysForLocalDay(new Date('2026-10-04T03:00:00Z'))
    expect(legacyKeys).toEqual(['2026-10-04'])
    const todayRows = await getTodayRowsWithLegacyUtcKeys(
      getForDate,
      '2026-10-03',
      legacyKeys,
      (row) => row.completed_at,
    )

    expect(getForDate.mock.calls).toEqual([['2026-10-03'], ['2026-10-04']])
    expect(todayRows).toEqual([local, legacy])
    expect(mergeTodayIntoHistory([local, legacy, earlier], todayRows, '2026-10-03')).toEqual([
      earlier,
      local,
      { ...legacy, date: '2026-10-03' },
    ])
  })

  it('checks the earlier UTC key even after UTC and local dates agree', async () => {
    vi.stubEnv('TZ', 'Asia/Kolkata')
    const legacyKeys = legacyUtcKeysForLocalDay(new Date('2026-10-04T08:00:00Z'))
    expect(legacyKeys).toEqual(['2026-10-03'])
    const getForDate = vi.fn(async (date: string) =>
      date === '2026-10-03'
        ? [{ id: 'early', date, logged_at: '2026-10-03T20:00:00Z' }]
        : [],
    )

    const rows = await getTodayRowsWithLegacyUtcKeys(
      getForDate,
      '2026-10-04',
      legacyKeys,
      (row) => row.logged_at,
    )
    expect(rows).toEqual([{ id: 'early', date: '2026-10-03', logged_at: '2026-10-03T20:00:00Z' }])
  })

  it('uses the exact local key when UTC has no adjacent day', async () => {
    vi.stubEnv('TZ', 'UTC')
    const getForDate = vi.fn(async () => [{ id: 'log', date: '2026-10-04', logged_at: '2026-10-04T10:00:00Z' }])

    await getTodayRowsWithLegacyUtcKeys(
      getForDate,
      '2026-10-04',
      legacyUtcKeysForLocalDay(new Date('2026-10-04T10:00:00Z')),
      (row) => row.logged_at,
    )

    expect(getForDate).toHaveBeenCalledExactlyOnceWith('2026-10-04')
  })
})
