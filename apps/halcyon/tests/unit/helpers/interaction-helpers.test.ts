import { describe, expect, it } from 'vitest'
import type { Interaction } from '~/types/database'
import {
  channelIcon,
  channelLabel,
  interactionIcon,
  interactionLabel,
  interactionSummary,
} from '~/utils/interaction-helpers'

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: 'i1',
    vault_id: 'v1',
    type: 'call',
    channel: null,
    subject: '',
    notes: '',
    happened_at: '2024-03-15T10:00:00Z',
    duration_minutes: null,
    created_at: '2024-03-15T10:00:00Z',
    updated_at: '2024-03-15T10:00:00Z',
    ...overrides,
  }
}

// ─── interactionLabel ─────────────────────────────────────────────────────────

describe('interactionLabel', () => {
  it('returns "Call" for call type', () => {
    expect(interactionLabel('call')).toBe('Call')
  })

  it('returns "Conversation" for conversation type', () => {
    expect(interactionLabel('conversation')).toBe('Conversation')
  })

  it('returns "Activity" for activity type', () => {
    expect(interactionLabel('activity')).toBe('Activity')
  })

  it('returns "Meeting" for meeting type', () => {
    expect(interactionLabel('meeting')).toBe('Meeting')
  })
})

// ─── interactionIcon ──────────────────────────────────────────────────────────

describe('interactionIcon', () => {
  it('returns a non-empty icon string for each type', () => {
    const types = ['call', 'conversation', 'activity', 'meeting'] as const
    for (const t of types) {
      expect(interactionIcon(t).length).toBeGreaterThan(0)
    }
  })
})

// ─── channelLabel ─────────────────────────────────────────────────────────────

describe('channelLabel', () => {
  it('returns "WhatsApp" for whatsapp', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp')
  })

  it('returns "SMS" for sms', () => {
    expect(channelLabel('sms')).toBe('SMS')
  })

  it('returns "Email" for email', () => {
    expect(channelLabel('email')).toBe('Email')
  })

  it('returns "In person" for in-person', () => {
    expect(channelLabel('in-person')).toBe('In person')
  })

  it('returns null for null channel', () => {
    expect(channelLabel(null)).toBeNull()
  })
})

// ─── channelIcon ──────────────────────────────────────────────────────────────

describe('channelIcon', () => {
  it('returns null for null channel', () => {
    expect(channelIcon(null)).toBeNull()
  })

  it('returns a non-empty string for known channels', () => {
    const channels = ['whatsapp', 'sms', 'email', 'telegram', 'facebook', 'in-person'] as const
    for (const c of channels) {
      const icon = channelIcon(c)
      expect(icon).not.toBeNull()
      expect((icon ?? '').length).toBeGreaterThan(0)
    }
  })
})

// ─── interactionSummary ───────────────────────────────────────────────────────

describe('interactionSummary', () => {
  it('returns subject when set', () => {
    const i = makeInteraction({ subject: 'Catch-up call' })
    expect(interactionSummary(i)).toBe('Catch-up call')
  })

  it('returns interaction label when subject is empty', () => {
    const i = makeInteraction({ type: 'activity', subject: '' })
    expect(interactionSummary(i)).toBe('Activity')
  })

  it('appends channel label when present and no subject', () => {
    const i = makeInteraction({ type: 'conversation', channel: 'whatsapp', subject: '' })
    expect(interactionSummary(i)).toBe('Conversation via WhatsApp')
  })

  it('appends duration for calls when > 0', () => {
    const i = makeInteraction({ type: 'call', duration_minutes: 30 })
    expect(interactionSummary(i)).toBe('Call (30 min)')
  })
})
