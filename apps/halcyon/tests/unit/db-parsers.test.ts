import { describe, expect, it } from 'vitest'
import { rowToContact } from '~/lib/db-parsers'

describe('rowToContact JSON columns', () => {
  const row = (tags: string | null) => ({
    id: 'contact-1',
    vault_id: 'vault-1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    nickname: '',
    maiden_name: '',
    middle_name: '',
    pronouns: '',
    gender: '',
    how_we_met: '',
    is_deceased: 0,
    deceased_at: null,
    birthday: null,
    is_starred: 0,
    last_contacted_at: null,
    avatar_url: null,
    tags,
    annotations: '{}',
    created_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z',
    archived_at: null,
  })

  it.each([null, 'null', 'not-json'])('falls back to an empty tag list for %s', (tags) => {
    expect(rowToContact(row(tags)).tags).toEqual([])
  })

  it('passes valid parsed values through without treating parsing as schema validation', () => {
    expect(rowToContact(row('{"unexpected":true}')).tags).toEqual({ unexpected: true })
  })
})
