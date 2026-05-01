// ─── Vault ────────────────────────────────────────────────────────────────────

export interface Vault {
  id: string
  name: string
  description: string
  color: string
  icon: string
  created_at: string
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export interface Contact {
  id: string
  vault_id: string
  first_name: string
  last_name: string
  nickname: string
  maiden_name: string
  middle_name: string
  pronouns: string
  gender: string
  how_we_met: string
  is_deceased: boolean
  deceased_at: string | null
  birthday: string | null // YYYY-MM-DD
  is_starred: boolean
  last_contacted_at: string | null // ISO timestamp
  avatar_url: string | null
  tags: string[]
  annotations: Record<string, string>
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface ContactFieldType {
  id: string
  vault_id: string
  name: string // "Phone", "Email", "WhatsApp"
  icon: string
  protocol: string // "tel:", "mailto:", "https://wa.me/"
  is_default: boolean
}

export interface ContactField {
  id: string
  contact_id: string
  type_id: string
  value: string
  label: string // "personal", "work"
  created_at: string
}

export type ContactFieldWithType = ContactField & { type: ContactFieldType }

// ─── Address ──────────────────────────────────────────────────────────────────

export interface AddressType {
  id: string
  vault_id: string
  name: string // "Home", "Work", "Other"
}

export interface Address {
  id: string
  contact_id: string
  type_id: string | null
  street: string
  city: string
  province: string
  postal_code: string
  country: string
  is_primary: boolean
  created_at: string
}

// ─── Relationships ────────────────────────────────────────────────────────────

export interface RelationshipType {
  id: string
  vault_id: string
  name: string // "partner of"
  name_reverse: string // "child of" or same if symmetric
  is_symmetric: boolean
  created_at: string
}

export interface Relationship {
  id: string
  contact_id: string
  related_id: string
  type_id: string
  notes: string
  created_at: string
}

export type RelationshipWithContact = Relationship & {
  related: Contact
  type: RelationshipType
}

// ─── Companies & Occupations ─────────────────────────────────────────────────

export interface Company {
  id: string
  vault_id: string
  name: string
  website: string
  description: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface Occupation {
  id: string
  contact_id: string
  company_id: string | null
  title: string
  department: string
  is_current: boolean
  started_at: string | null // YYYY-MM-DD
  ended_at: string | null
  created_at: string
}

export type OccupationWithCompany = Occupation & { company: Company | null }

// ─── Pets ─────────────────────────────────────────────────────────────────────

export interface Pet {
  id: string
  contact_id: string
  name: string
  species: string
  breed: string
  created_at: string
}

// ─── Tags & Groups ────────────────────────────────────────────────────────────

export interface Tag {
  id: string
  vault_id: string
  name: string
  color: string
}

export interface Group {
  id: string
  vault_id: string
  name: string
  description: string
  created_at: string
}

export type GroupWithCount = Group & { member_count: number }

// ─── Interactions ─────────────────────────────────────────────────────────────

export type InteractionType = 'call' | 'conversation' | 'activity' | 'meeting'
export type ConversationChannel =
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'telegram'
  | 'facebook'
  | 'in-person'
  | 'other'

export interface Interaction {
  id: string
  vault_id: string
  type: InteractionType
  channel: ConversationChannel | null
  subject: string
  notes: string
  happened_at: string // ISO timestamp
  duration_minutes: number | null
  created_at: string
  updated_at: string
}

export type InteractionWithContacts = Interaction & { contacts: Contact[] }

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface Note {
  id: string
  contact_id: string
  body: string
  is_pinned: boolean
  created_at: string
  updated_at: string
}

// ─── Life Events ──────────────────────────────────────────────────────────────

export interface LifeEventType {
  id: string
  vault_id: string
  name: string
  icon: string
  category: string
}

export interface LifeEvent {
  id: string
  contact_id: string
  type_id: string | null
  label: string
  notes: string
  happened_at: string | null // YYYY-MM-DD
  yearly_reminder: boolean
  created_at: string
}

export type LifeEventWithType = LifeEvent & { type: LifeEventType | null }

// ─── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string
  contact_id: string
  title: string
  body: string
  remind_at: string // YYYY-MM-DD
  is_yearly: boolean
  is_done: boolean
  done_at: string | null
  created_at: string
}

// ─── Stay-in-touch ────────────────────────────────────────────────────────────

export interface StayInTouch {
  id: string
  contact_id: string
  frequency_days: number
  last_contacted_at: string | null
  next_remind_at: string // YYYY-MM-DD
  created_at: string
  updated_at: string
}

export type StayInTouchWithContact = StayInTouch & { contact: Contact }

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  contact_id: string
  title: string
  notes: string
  due_at: string | null // YYYY-MM-DD
  is_done: boolean
  done_at: string | null
  created_at: string
  updated_at: string
}

// ─── Gift Notes ───────────────────────────────────────────────────────────────

export interface GiftNote {
  id: string
  contact_id: string
  idea: string
  occasion: string
  is_given: boolean
  given_at: string | null
  created_at: string
}

// ─── Journal ──────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string
  vault_id: string
  title: string
  body: string
  date: string // YYYY-MM-DD
  created_at: string
  updated_at: string
}

// ─── Contact detail (full) ────────────────────────────────────────────────────

export interface ContactDetail extends Contact {
  fields: ContactFieldWithType[]
  addresses: Address[]
  relationships: RelationshipWithContact[]
  current_occupation: OccupationWithCompany | null
  past_occupations: OccupationWithCompany[]
  pets: Pet[]
  stay_in_touch: StayInTouch | null
}

// ─── Worker message bus ───────────────────────────────────────────────────────

export type WorkerRequestBody =
  // Vaults
  | { type: 'GET_VAULTS' }
  | { type: 'CREATE_VAULT'; payload: Omit<Vault, 'id' | 'created_at'> }
  | { type: 'UPDATE_VAULT'; payload: Partial<Vault> & { id: string } }
  | { type: 'DELETE_VAULT'; payload: { id: string } }
  // Contacts
  | { type: 'GET_CONTACTS'; payload: { vault_id: string } }
  | { type: 'GET_CONTACT'; payload: { id: string } }
  | { type: 'GET_CONTACT_DETAIL'; payload: { id: string } }
  | {
      type: 'CREATE_CONTACT'
      payload: Omit<
        Contact,
        'id' | 'created_at' | 'updated_at' | 'archived_at' | 'last_contacted_at'
      >
    }
  | { type: 'UPDATE_CONTACT'; payload: Partial<Contact> & { id: string } }
  | { type: 'ARCHIVE_CONTACT'; payload: { id: string } }
  | { type: 'UNARCHIVE_CONTACT'; payload: { id: string } }
  | { type: 'TOGGLE_STAR_CONTACT'; payload: { id: string } }
  // Contact fields
  | { type: 'GET_CONTACT_FIELD_TYPES'; payload: { vault_id: string } }
  | { type: 'CREATE_CONTACT_FIELD_TYPE'; payload: Omit<ContactFieldType, 'id'> }
  | { type: 'UPDATE_CONTACT_FIELD_TYPE'; payload: Partial<ContactFieldType> & { id: string } }
  | { type: 'DELETE_CONTACT_FIELD_TYPE'; payload: { id: string } }
  | { type: 'CREATE_CONTACT_FIELD'; payload: Omit<ContactField, 'id' | 'created_at'> }
  | { type: 'UPDATE_CONTACT_FIELD'; payload: Partial<ContactField> & { id: string } }
  | { type: 'DELETE_CONTACT_FIELD'; payload: { id: string } }
  // Addresses
  | { type: 'GET_ADDRESS_TYPES'; payload: { vault_id: string } }
  | { type: 'CREATE_ADDRESS_TYPE'; payload: Omit<AddressType, 'id'> }
  | { type: 'CREATE_ADDRESS'; payload: Omit<Address, 'id' | 'created_at'> }
  | { type: 'UPDATE_ADDRESS'; payload: Partial<Address> & { id: string } }
  | { type: 'DELETE_ADDRESS'; payload: { id: string } }
  // Relationships
  | { type: 'GET_RELATIONSHIP_TYPES'; payload: { vault_id: string } }
  | { type: 'CREATE_RELATIONSHIP_TYPE'; payload: Omit<RelationshipType, 'id' | 'created_at'> }
  | { type: 'UPDATE_RELATIONSHIP_TYPE'; payload: Partial<RelationshipType> & { id: string } }
  | { type: 'DELETE_RELATIONSHIP_TYPE'; payload: { id: string } }
  | { type: 'CREATE_RELATIONSHIP'; payload: Omit<Relationship, 'id' | 'created_at'> }
  | { type: 'DELETE_RELATIONSHIP'; payload: { id: string } }
  // Companies
  | { type: 'GET_COMPANIES'; payload: { vault_id: string } }
  | { type: 'GET_COMPANY'; payload: { id: string } }
  | { type: 'GET_COMPANY_CONTACTS'; payload: { company_id: string } }
  | { type: 'CREATE_COMPANY'; payload: Omit<Company, 'id' | 'created_at' | 'updated_at'> }
  | { type: 'UPDATE_COMPANY'; payload: Partial<Company> & { id: string } }
  | { type: 'DELETE_COMPANY'; payload: { id: string } }
  // Occupations
  | { type: 'GET_OCCUPATIONS'; payload: { contact_id: string } }
  | { type: 'CREATE_OCCUPATION'; payload: Omit<Occupation, 'id' | 'created_at'> }
  | { type: 'UPDATE_OCCUPATION'; payload: Partial<Occupation> & { id: string } }
  | { type: 'DELETE_OCCUPATION'; payload: { id: string } }
  // Pets
  | { type: 'GET_PETS'; payload: { contact_id: string } }
  | { type: 'CREATE_PET'; payload: Omit<Pet, 'id' | 'created_at'> }
  | { type: 'UPDATE_PET'; payload: Partial<Pet> & { id: string } }
  | { type: 'DELETE_PET'; payload: { id: string } }
  // Tags
  | { type: 'GET_TAGS'; payload: { vault_id: string } }
  | { type: 'CREATE_TAG'; payload: Omit<Tag, 'id'> }
  | { type: 'UPDATE_TAG'; payload: Partial<Tag> & { id: string } }
  | { type: 'DELETE_TAG'; payload: { id: string } }
  | { type: 'SET_CONTACT_TAGS'; payload: { contact_id: string; tag_ids: string[] } }
  // Groups
  | { type: 'GET_GROUPS'; payload: { vault_id: string } }
  | { type: 'GET_GROUP'; payload: { id: string } }
  | { type: 'CREATE_GROUP'; payload: Omit<Group, 'id' | 'created_at'> }
  | { type: 'UPDATE_GROUP'; payload: Partial<Group> & { id: string } }
  | { type: 'DELETE_GROUP'; payload: { id: string } }
  | { type: 'ADD_TO_GROUP'; payload: { group_id: string; contact_id: string } }
  | { type: 'REMOVE_FROM_GROUP'; payload: { group_id: string; contact_id: string } }
  | { type: 'GET_GROUP_CONTACTS'; payload: { group_id: string } }
  // Interactions
  | { type: 'GET_INTERACTIONS'; payload: { vault_id: string; contact_id?: string; limit?: number } }
  | { type: 'GET_INTERACTION'; payload: { id: string } }
  | {
      type: 'CREATE_INTERACTION'
      payload: Omit<Interaction, 'id' | 'created_at' | 'updated_at'> & { contact_ids: string[] }
    }
  | {
      type: 'UPDATE_INTERACTION'
      payload: Partial<Interaction> & { id: string } & { contact_ids?: string[] }
    }
  | { type: 'DELETE_INTERACTION'; payload: { id: string } }
  // Notes
  | { type: 'GET_NOTES'; payload: { contact_id: string } }
  | { type: 'CREATE_NOTE'; payload: Omit<Note, 'id' | 'created_at' | 'updated_at'> }
  | { type: 'UPDATE_NOTE'; payload: Partial<Note> & { id: string } }
  | { type: 'DELETE_NOTE'; payload: { id: string } }
  | { type: 'TOGGLE_PIN_NOTE'; payload: { id: string } }
  // Life events
  | { type: 'GET_LIFE_EVENT_TYPES'; payload: { vault_id: string } }
  | { type: 'CREATE_LIFE_EVENT_TYPE'; payload: Omit<LifeEventType, 'id'> }
  | { type: 'GET_LIFE_EVENTS'; payload: { contact_id: string } }
  | { type: 'CREATE_LIFE_EVENT'; payload: Omit<LifeEvent, 'id' | 'created_at'> }
  | { type: 'UPDATE_LIFE_EVENT'; payload: Partial<LifeEvent> & { id: string } }
  | { type: 'DELETE_LIFE_EVENT'; payload: { id: string } }
  // Reminders
  | { type: 'GET_REMINDERS'; payload: { contact_id: string } }
  | { type: 'GET_UPCOMING_REMINDERS'; payload: { vault_id: string; days: number } }
  | {
      type: 'CREATE_REMINDER'
      payload: Omit<Reminder, 'id' | 'created_at' | 'is_done' | 'done_at'>
    }
  | { type: 'UPDATE_REMINDER'; payload: Partial<Reminder> & { id: string } }
  | { type: 'DONE_REMINDER'; payload: { id: string } }
  | { type: 'DELETE_REMINDER'; payload: { id: string } }
  // Stay-in-touch
  | { type: 'GET_STAY_IN_TOUCH'; payload: { contact_id: string } }
  | { type: 'GET_OVERDUE_STAY_IN_TOUCH'; payload: { vault_id: string } }
  | { type: 'SET_STAY_IN_TOUCH'; payload: { contact_id: string; frequency_days: number } }
  | { type: 'REMOVE_STAY_IN_TOUCH'; payload: { contact_id: string } }
  | { type: 'MARK_CONTACTED'; payload: { contact_id: string } }
  // Tasks
  | { type: 'GET_TASKS'; payload: { contact_id: string } }
  | {
      type: 'CREATE_TASK'
      payload: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at'>
    }
  | { type: 'UPDATE_TASK'; payload: Partial<Task> & { id: string } }
  | { type: 'TOGGLE_TASK'; payload: { id: string } }
  | { type: 'DELETE_TASK'; payload: { id: string } }
  // Gift notes
  | { type: 'GET_GIFT_NOTES'; payload: { contact_id: string } }
  | {
      type: 'CREATE_GIFT_NOTE'
      payload: Omit<GiftNote, 'id' | 'created_at' | 'is_given' | 'given_at'>
    }
  | { type: 'UPDATE_GIFT_NOTE'; payload: Partial<GiftNote> & { id: string } }
  | { type: 'MARK_GIFT_GIVEN'; payload: { id: string } }
  | { type: 'DELETE_GIFT_NOTE'; payload: { id: string } }
  // Journal
  | { type: 'GET_JOURNAL_ENTRIES'; payload: { vault_id: string } }
  | { type: 'GET_JOURNAL_ENTRY'; payload: { date: string; vault_id: string } }
  | {
      type: 'UPSERT_JOURNAL_ENTRY'
      payload: Omit<JournalEntry, 'id' | 'created_at' | 'updated_at'>
    }
  | { type: 'DELETE_JOURNAL_ENTRY'; payload: { id: string } }
  // Search
  | { type: 'SEARCH'; payload: { vault_id: string; query: string } }
  // Dashboard
  | { type: 'GET_DASHBOARD'; payload: { vault_id: string } }
  // Export/Import
  | { type: 'EXPORT_VAULT'; payload: { vault_id: string } }

export type WorkerRequest = WorkerRequestBody & { id: string }

export type WorkerResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }

// ─── Search results ───────────────────────────────────────────────────────────

export interface SearchResult {
  contacts: Contact[]
  notes: Array<Note & { contact: Contact }>
}

// ─── Dashboard data ───────────────────────────────────────────────────────────

export interface DashboardData {
  upcoming_dates: Array<{
    contact: Contact
    reminder: Reminder
    days_away: number
  }>
  upcoming_birthdays: Array<{
    contact: Contact
    days_away: number
    turning_age: number | null
  }>
  overdue_stay_in_touch: StayInTouchWithContact[]
  recent_interactions: InteractionWithContacts[]
}

// ─── Export ───────────────────────────────────────────────────────────────────

export interface HalcyonExport {
  version: number
  exported_at: string
  vault: Vault
  contacts: Contact[]
  contact_fields: ContactField[]
  contact_field_types: ContactFieldType[]
  addresses: Address[]
  address_types: AddressType[]
  relationships: Relationship[]
  relationship_types: RelationshipType[]
  companies: Company[]
  occupations: Occupation[]
  pets: Pet[]
  tags: Tag[]
  groups: Group[]
  interactions: Interaction[]
  notes: Note[]
  life_events: LifeEvent[]
  life_event_types: LifeEventType[]
  reminders: Reminder[]
  stay_in_touch: StayInTouch[]
  tasks: Task[]
  gift_notes: GiftNote[]
  journal_entries: JournalEntry[]
}
