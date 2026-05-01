import type { ConversationChannel, Interaction, InteractionType } from '~/types/database'

const TYPE_LABELS: Record<InteractionType, string> = {
  call: 'Call',
  conversation: 'Conversation',
  activity: 'Activity',
  meeting: 'Meeting',
}

const TYPE_ICONS: Record<InteractionType, string> = {
  call: 'i-heroicons-phone',
  conversation: 'i-heroicons-chat-bubble-left-right',
  activity: 'i-heroicons-sparkles',
  meeting: 'i-heroicons-briefcase',
}

const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  telegram: 'Telegram',
  facebook: 'Facebook',
  'in-person': 'In person',
  other: 'Other',
}

const CHANNEL_ICONS: Record<ConversationChannel, string> = {
  whatsapp: 'i-heroicons-chat-bubble-oval-left',
  sms: 'i-heroicons-device-phone-mobile',
  email: 'i-heroicons-envelope',
  telegram: 'i-heroicons-paper-airplane',
  facebook: 'i-heroicons-chat-bubble-left',
  'in-person': 'i-heroicons-user',
  other: 'i-heroicons-ellipsis-horizontal',
}

export function interactionLabel(type: InteractionType): string {
  return TYPE_LABELS[type]
}

export function interactionIcon(type: InteractionType): string {
  return TYPE_ICONS[type]
}

export function channelLabel(channel: ConversationChannel | null): string | null {
  if (!channel) return null
  return CHANNEL_LABELS[channel]
}

export function channelIcon(channel: ConversationChannel | null): string | null {
  if (!channel) return null
  return CHANNEL_ICONS[channel]
}

/** Short one-line summary of an interaction for list display */
export function interactionSummary(interaction: Interaction): string {
  const { type, channel, subject, duration_minutes } = interaction

  if (subject) return subject

  const base = interactionLabel(type)

  if (channel) {
    const cl = channelLabel(channel)
    if (cl) return `${base} via ${cl}`
  }

  if (type === 'call' && duration_minutes && duration_minutes > 0) {
    return `${base} (${duration_minutes} min)`
  }

  return base
}
