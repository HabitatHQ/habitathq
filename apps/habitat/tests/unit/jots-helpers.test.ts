import { describe, it, expect } from 'vitest'
import type { JotItem } from '~/composables/useJotsStore'
import type { Scribble } from '~/types/database'
import { groupJotsByDate, groupJotsByTags, getJotDate } from '~/utils/jots-helpers'

function makeTextJot(overrides: Partial<Scribble> & { id?: string } = {}): JotItem {
  return {
    kind: 'text',
    data: {
      id: overrides.id ?? 'text-1',
      title: 'Note',
      content: 'body',
      tags: [],
      annotations: {},
      created_at: '2026-05-28T10:00:00Z',
      updated_at: '2026-05-28T10:00:00Z',
      ...overrides,
    },
  }
}

function makeVoiceJot(id: string, created_at: string, title = ''): JotItem {
  return {
    kind: 'voice',
    data: { id, title, blob: new Blob(), mimeType: 'audio/webm', duration: 10, created_at },
  }
}

function makeImageJot(id: string, created_at: string, filename = 'img.jpg'): JotItem {
  return {
    kind: 'image',
    data: { id, blob: new Blob(), mimeType: 'image/jpeg', filename, created_at },
  }
}

describe('getJotDate', () => {
  it('returns updated_at for text jots', () => {
    const item = makeTextJot({ updated_at: '2026-05-20T12:00:00Z' })
    expect(getJotDate(item)).toBe('2026-05-20T12:00:00Z')
  })

  it('returns created_at for voice jots', () => {
    const item = makeVoiceJot('v1', '2026-05-19T08:00:00Z')
    expect(getJotDate(item)).toBe('2026-05-19T08:00:00Z')
  })

  it('returns created_at for image jots', () => {
    const item = makeImageJot('i1', '2026-05-18T06:00:00Z')
    expect(getJotDate(item)).toBe('2026-05-18T06:00:00Z')
  })
})

describe('groupJotsByDate', () => {
  const now = new Date('2026-05-28T15:00:00Z')

  it('puts items from today into "Today"', () => {
    const items = [makeTextJot({ updated_at: '2026-05-28T10:00:00Z' })]
    const sections = groupJotsByDate(items, now)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Today')
    expect(sections[0]!.items).toHaveLength(1)
  })

  it('puts items from yesterday into "Last 7 Days"', () => {
    const items = [makeVoiceJot('v1', '2026-05-27T10:00:00Z')]
    const sections = groupJotsByDate(items, now)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Last 7 Days')
  })

  it('puts items from 10 days ago into "Last 30 Days"', () => {
    const items = [makeImageJot('i1', '2026-05-18T10:00:00Z')]
    const sections = groupJotsByDate(items, now)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Last 30 Days')
  })

  it('groups older items by month name', () => {
    const items = [makeTextJot({ updated_at: '2026-03-15T10:00:00Z' })]
    const sections = groupJotsByDate(items, now)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('March')
  })

  it('appends year for months in a different year', () => {
    const items = [makeTextJot({ updated_at: '2025-12-01T10:00:00Z' })]
    const sections = groupJotsByDate(items, now)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('December 2025')
  })

  it('excludes empty sections', () => {
    const sections = groupJotsByDate([], now)
    expect(sections).toHaveLength(0)
  })

  it('orders sections chronologically (recent first)', () => {
    const items = [
      makeTextJot({ id: 'a', updated_at: '2026-05-28T10:00:00Z' }),
      makeVoiceJot('b', '2026-05-25T10:00:00Z'),
      makeImageJot('c', '2026-05-10T10:00:00Z'),
      makeTextJot({ id: 'd', updated_at: '2026-03-01T10:00:00Z' }),
      makeTextJot({ id: 'e', updated_at: '2026-02-01T10:00:00Z' }),
    ]
    const sections = groupJotsByDate(items, now)
    expect(sections.map((s) => s.label)).toEqual([
      'Today',
      'Last 7 Days',
      'Last 30 Days',
      'March',
      'February',
    ])
  })
})

describe('groupJotsByTags', () => {
  it('groups text jots by their tags', () => {
    const items = [
      makeTextJot({ id: 'a', tags: ['spark'] }),
      makeTextJot({ id: 'b', tags: ['brain-dump'] }),
    ]
    const sections = groupJotsByTags(items)
    expect(sections.map((s) => s.label)).toEqual(['brain-dump', 'spark'])
  })

  it('places jots with multiple tags in each group', () => {
    const items = [makeTextJot({ id: 'a', tags: ['spark', 'gratitude'] })]
    const sections = groupJotsByTags(items)
    expect(sections).toHaveLength(2)
    expect(sections[0]!.label).toBe('gratitude')
    expect(sections[1]!.label).toBe('spark')
    expect(sections[0]!.items[0]).toBe(sections[1]!.items[0])
  })

  it('puts voice/image jots in "Untagged"', () => {
    const items = [makeVoiceJot('v1', '2026-05-28T10:00:00Z'), makeImageJot('i1', '2026-05-28T10:00:00Z')]
    const sections = groupJotsByTags(items)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Untagged')
    expect(sections[0]!.items).toHaveLength(2)
  })

  it('puts untagged text jots in "Untagged"', () => {
    const items = [makeTextJot({ id: 'a', tags: [] })]
    const sections = groupJotsByTags(items)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.label).toBe('Untagged')
  })

  it('places "Untagged" at the end', () => {
    const items = [
      makeTextJot({ id: 'a', tags: ['spark'] }),
      makeVoiceJot('v1', '2026-05-28T10:00:00Z'),
    ]
    const sections = groupJotsByTags(items)
    expect(sections[sections.length - 1]!.label).toBe('Untagged')
  })
})
