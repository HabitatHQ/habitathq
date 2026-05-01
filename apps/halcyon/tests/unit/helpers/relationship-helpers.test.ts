import { describe, expect, it } from 'vitest'
import type { Contact, Relationship, RelationshipType } from '~/types/database'
import {
  getRelationshipLabel,
  groupRelationshipsByType,
  isSymmetricRelationship,
  relationshipDisplayName,
} from '~/utils/relationship-helpers'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    vault_id: 'v1',
    first_name: 'Alice',
    last_name: 'Smith',
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

function makeRelType(overrides: Partial<RelationshipType> = {}): RelationshipType {
  return {
    id: 'rt1',
    vault_id: 'v1',
    name: 'parent of',
    name_reverse: 'child of',
    is_symmetric: false,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeRel(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: 'r1',
    contact_id: 'c1',
    related_id: 'c2',
    type_id: 'rt1',
    notes: '',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── getRelationshipLabel ─────────────────────────────────────────────────────

describe('getRelationshipLabel', () => {
  it('returns type.name when viewing from contact_id perspective', () => {
    const rel = makeRel({ contact_id: 'c1', related_id: 'c2' })
    const type = makeRelType({ name: 'parent of', name_reverse: 'child of' })
    // Viewing from Alice (c1) toward Bob (c2): Alice is "parent of" Bob
    expect(getRelationshipLabel(rel, type, 'c1')).toBe('parent of')
  })

  it('returns type.name_reverse when viewing from related_id perspective', () => {
    const rel = makeRel({ contact_id: 'c1', related_id: 'c2' })
    const type = makeRelType({ name: 'parent of', name_reverse: 'child of' })
    // Viewing from Bob (c2) toward Alice (c1): Bob is "child of" Alice
    expect(getRelationshipLabel(rel, type, 'c2')).toBe('child of')
  })

  it('returns the same label for symmetric relationships regardless of perspective', () => {
    const rel = makeRel({ contact_id: 'c1', related_id: 'c2' })
    const type = makeRelType({ name: 'partner of', name_reverse: 'partner of', is_symmetric: true })
    expect(getRelationshipLabel(rel, type, 'c1')).toBe('partner of')
    expect(getRelationshipLabel(rel, type, 'c2')).toBe('partner of')
  })
})

// ─── relationshipDisplayName ──────────────────────────────────────────────────

describe('relationshipDisplayName', () => {
  it('capitalizes the relationship label', () => {
    const rel = makeRel()
    const type = makeRelType({ name: 'partner of' })
    const related = makeContact({ first_name: 'Bob', last_name: '' })
    expect(relationshipDisplayName(rel, type, 'c1', related)).toBe('Partner of Bob')
  })

  it('includes both contact names for clarity', () => {
    const rel = makeRel()
    const type = makeRelType({ name: 'parent of', name_reverse: 'child of' })
    const related = makeContact({ first_name: 'Charlie', last_name: 'Smith' })
    const result = relationshipDisplayName(rel, type, 'c1', related)
    expect(result).toContain('Charlie')
    expect(result).toContain('Parent of')
  })
})

// ─── isSymmetricRelationship ──────────────────────────────────────────────────

describe('isSymmetricRelationship', () => {
  it('returns true for symmetric types', () => {
    const type = makeRelType({ is_symmetric: true })
    expect(isSymmetricRelationship(type)).toBe(true)
  })

  it('returns false for asymmetric types', () => {
    const type = makeRelType({ is_symmetric: false })
    expect(isSymmetricRelationship(type)).toBe(false)
  })
})

// ─── groupRelationshipsByType ─────────────────────────────────────────────────

describe('groupRelationshipsByType', () => {
  it('groups relationships by their type name', () => {
    const items = [
      { rel: makeRel({ id: 'r1', type_id: 'rt1' }), type: makeRelType({ id: 'rt1', name: 'friend of' }), contact: makeContact({ id: 'c2', first_name: 'Bob' }) },
      { rel: makeRel({ id: 'r2', type_id: 'rt1' }), type: makeRelType({ id: 'rt1', name: 'friend of' }), contact: makeContact({ id: 'c3', first_name: 'Carol' }) },
      { rel: makeRel({ id: 'r3', type_id: 'rt2' }), type: makeRelType({ id: 'rt2', name: 'colleague of' }), contact: makeContact({ id: 'c4', first_name: 'Dave' }) },
    ]
    const grouped = groupRelationshipsByType(items)
    expect(grouped.size).toBe(2)
    expect(grouped.get('friend of')?.length).toBe(2)
    expect(grouped.get('colleague of')?.length).toBe(1)
  })

  it('returns empty map for empty input', () => {
    expect(groupRelationshipsByType([]).size).toBe(0)
  })
})
