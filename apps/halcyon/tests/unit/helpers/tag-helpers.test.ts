import { describe, expect, it } from 'vitest'
import type { Contact, Tag } from '~/types/database'
import {
  contactTagObjects,
  filterContactsByTag,
  sortTagsByName,
  tagDisplayColor,
} from '~/utils/tag-helpers'

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 't1',
    vault_id: 'v1',
    name: 'work',
    color: '#7c3aed',
    ...overrides,
  }
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    vault_id: 'v1',
    first_name: 'Alice',
    last_name: '',
    nickname: '',
    maiden_name: '',
    middle_name: '',
    pronouns: '',
    gender: '',
    how_we_met: '',
    is_deceased: false,
    deceased_at: null,
    birthday: null,
    is_starred: false,
    last_contacted_at: null,
    avatar_url: null,
    tags: [],
    annotations: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

// ─── sortTagsByName ───────────────────────────────────────────────────────────

describe('sortTagsByName', () => {
  it('sorts tags alphabetically by name', () => {
    const tags = [
      makeTag({ id: 't3', name: 'work' }),
      makeTag({ id: 't1', name: 'family' }),
      makeTag({ id: 't2', name: 'college' }),
    ]
    const sorted = sortTagsByName(tags)
    expect(sorted.map((t) => t.name)).toEqual(['college', 'family', 'work'])
  })

  it('returns empty array for empty input', () => {
    expect(sortTagsByName([])).toEqual([])
  })
})

// ─── tagDisplayColor ──────────────────────────────────────────────────────────

describe('tagDisplayColor', () => {
  it('returns the tag color as-is for hex colors', () => {
    const tag = makeTag({ color: '#ff5733' })
    expect(tagDisplayColor(tag)).toBe('#ff5733')
  })

  it('falls back to default violet when color is empty', () => {
    const tag = makeTag({ color: '' })
    expect(tagDisplayColor(tag)).toBe('#7c3aed')
  })
})

// ─── filterContactsByTag ──────────────────────────────────────────────────────

describe('filterContactsByTag', () => {
  const contacts = [
    makeContact({ id: 'c1', tags: ['work', 'close-friend'] }),
    makeContact({ id: 'c2', tags: ['family'] }),
    makeContact({ id: 'c3', tags: ['work', 'family'] }),
    makeContact({ id: 'c4', tags: [] }),
  ]

  it('returns contacts that have the given tag', () => {
    const result = filterContactsByTag(contacts, 'work')
    expect(result.map((c) => c.id)).toEqual(['c1', 'c3'])
  })

  it('returns all contacts when tag is null', () => {
    expect(filterContactsByTag(contacts, null)).toHaveLength(4)
  })

  it('returns empty array when no contacts have the tag', () => {
    expect(filterContactsByTag(contacts, 'vip')).toHaveLength(0)
  })
})

// ─── contactTagObjects ────────────────────────────────────────────────────────

describe('contactTagObjects', () => {
  it('resolves tag name strings to Tag objects from the vault registry', () => {
    const contact = makeContact({ tags: ['work', 'family'] })
    const allTags = [
      makeTag({ id: 't1', name: 'work' }),
      makeTag({ id: 't2', name: 'family' }),
      makeTag({ id: 't3', name: 'college' }),
    ]
    const result = contactTagObjects(contact, allTags)
    expect(result.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('ignores tag names not in the vault registry', () => {
    const contact = makeContact({ tags: ['ghost-tag'] })
    const allTags = [makeTag({ name: 'work' })]
    expect(contactTagObjects(contact, allTags)).toHaveLength(0)
  })
})
