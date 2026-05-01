import { sendToWorker } from '~/plugins/database.client'
import type {
  Address,
  AddressType,
  Company,
  Contact,
  ContactDetail,
  ContactField,
  ContactFieldType,
  DashboardData,
  GiftNote,
  Group,
  GroupWithCount,
  HalcyonExport,
  Interaction,
  InteractionWithContacts,
  JournalEntry,
  LifeEvent,
  LifeEventType,
  Note,
  Occupation,
  OccupationWithCompany,
  Pet,
  Relationship,
  RelationshipType,
  Reminder,
  SearchResult,
  StayInTouch,
  StayInTouchWithContact,
  Tag,
  Task,
  Vault,
} from '~/types/database'

export function useDatabase() {
  return {
    isAvailable: true as const,

    // ── Vaults ──────────────────────────────────────────────────────────────
    getVaults: (): Promise<Vault[]> => sendToWorker({ type: 'GET_VAULTS' }),
    createVault: (p: Omit<Vault, 'id' | 'created_at'>): Promise<Vault> =>
      sendToWorker({ type: 'CREATE_VAULT', payload: p }),
    updateVault: (p: Partial<Vault> & { id: string }): Promise<Vault> =>
      sendToWorker({ type: 'UPDATE_VAULT', payload: p }),
    deleteVault: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_VAULT', payload: { id } }),

    // ── Contacts ────────────────────────────────────────────────────────────
    getContacts: (vault_id: string): Promise<Contact[]> =>
      sendToWorker({ type: 'GET_CONTACTS', payload: { vault_id } }),
    getContact: (id: string): Promise<Contact> =>
      sendToWorker({ type: 'GET_CONTACT', payload: { id } }),
    getContactDetail: (id: string): Promise<ContactDetail> =>
      sendToWorker({ type: 'GET_CONTACT_DETAIL', payload: { id } }),
    createContact: (
      p: Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'archived_at' | 'last_contacted_at'>,
    ): Promise<Contact> => sendToWorker({ type: 'CREATE_CONTACT', payload: p }),
    updateContact: (p: Partial<Contact> & { id: string }): Promise<Contact> =>
      sendToWorker({ type: 'UPDATE_CONTACT', payload: p }),
    archiveContact: (id: string): Promise<null> =>
      sendToWorker({ type: 'ARCHIVE_CONTACT', payload: { id } }),
    unarchiveContact: (id: string): Promise<null> =>
      sendToWorker({ type: 'UNARCHIVE_CONTACT', payload: { id } }),
    toggleStarContact: (id: string): Promise<Contact> =>
      sendToWorker({ type: 'TOGGLE_STAR_CONTACT', payload: { id } }),

    // ── Contact field types ──────────────────────────────────────────────────
    getContactFieldTypes: (vault_id: string): Promise<ContactFieldType[]> =>
      sendToWorker({ type: 'GET_CONTACT_FIELD_TYPES', payload: { vault_id } }),
    createContactFieldType: (p: Omit<ContactFieldType, 'id'>): Promise<ContactFieldType> =>
      sendToWorker({ type: 'CREATE_CONTACT_FIELD_TYPE', payload: p }),
    updateContactFieldType: (
      p: Partial<ContactFieldType> & { id: string },
    ): Promise<ContactFieldType> => sendToWorker({ type: 'UPDATE_CONTACT_FIELD_TYPE', payload: p }),
    deleteContactFieldType: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CONTACT_FIELD_TYPE', payload: { id } }),

    // ── Contact fields ────────────────────────────────────────────────────────
    createContactField: (p: Omit<ContactField, 'id' | 'created_at'>): Promise<ContactField> =>
      sendToWorker({ type: 'CREATE_CONTACT_FIELD', payload: p }),
    updateContactField: (p: Partial<ContactField> & { id: string }): Promise<ContactField> =>
      sendToWorker({ type: 'UPDATE_CONTACT_FIELD', payload: p }),
    deleteContactField: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_CONTACT_FIELD', payload: { id } }),

    // ── Addresses ─────────────────────────────────────────────────────────────
    getAddressTypes: (vault_id: string): Promise<AddressType[]> =>
      sendToWorker({ type: 'GET_ADDRESS_TYPES', payload: { vault_id } }),
    createAddressType: (p: Omit<AddressType, 'id'>): Promise<null> =>
      sendToWorker({ type: 'CREATE_ADDRESS_TYPE', payload: p }),
    createAddress: (p: Omit<Address, 'id' | 'created_at'>): Promise<Address> =>
      sendToWorker({ type: 'CREATE_ADDRESS', payload: p }),
    updateAddress: (p: Partial<Address> & { id: string }): Promise<Address> =>
      sendToWorker({ type: 'UPDATE_ADDRESS', payload: p }),
    deleteAddress: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_ADDRESS', payload: { id } }),

    // ── Relationship types ────────────────────────────────────────────────────
    getRelationshipTypes: (vault_id: string): Promise<RelationshipType[]> =>
      sendToWorker({ type: 'GET_RELATIONSHIP_TYPES', payload: { vault_id } }),
    createRelationshipType: (
      p: Omit<RelationshipType, 'id' | 'created_at'>,
    ): Promise<RelationshipType> => sendToWorker({ type: 'CREATE_RELATIONSHIP_TYPE', payload: p }),
    updateRelationshipType: (
      p: Partial<RelationshipType> & { id: string },
    ): Promise<RelationshipType> => sendToWorker({ type: 'UPDATE_RELATIONSHIP_TYPE', payload: p }),
    deleteRelationshipType: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_RELATIONSHIP_TYPE', payload: { id } }),
    createRelationship: (p: Omit<Relationship, 'id' | 'created_at'>): Promise<Relationship> =>
      sendToWorker({ type: 'CREATE_RELATIONSHIP', payload: p }),
    deleteRelationship: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_RELATIONSHIP', payload: { id } }),

    // ── Companies ────────────────────────────────────────────────────────────
    getCompanies: (vault_id: string): Promise<Company[]> =>
      sendToWorker({ type: 'GET_COMPANIES', payload: { vault_id } }),
    getCompany: (id: string): Promise<Company> =>
      sendToWorker({ type: 'GET_COMPANY', payload: { id } }),
    getCompanyContacts: (company_id: string): Promise<Contact[]> =>
      sendToWorker({ type: 'GET_COMPANY_CONTACTS', payload: { company_id } }),
    createCompany: (p: Omit<Company, 'id' | 'created_at' | 'updated_at'>): Promise<Company> =>
      sendToWorker({ type: 'CREATE_COMPANY', payload: p }),
    updateCompany: (p: Partial<Company> & { id: string }): Promise<Company> =>
      sendToWorker({ type: 'UPDATE_COMPANY', payload: p }),
    deleteCompany: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_COMPANY', payload: { id } }),

    // ── Occupations ───────────────────────────────────────────────────────────
    getOccupations: (contact_id: string): Promise<OccupationWithCompany[]> =>
      sendToWorker({ type: 'GET_OCCUPATIONS', payload: { contact_id } }),
    createOccupation: (p: Omit<Occupation, 'id' | 'created_at'>): Promise<Occupation> =>
      sendToWorker({ type: 'CREATE_OCCUPATION', payload: p }),
    updateOccupation: (p: Partial<Occupation> & { id: string }): Promise<Occupation> =>
      sendToWorker({ type: 'UPDATE_OCCUPATION', payload: p }),
    deleteOccupation: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_OCCUPATION', payload: { id } }),

    // ── Pets ──────────────────────────────────────────────────────────────────
    getPets: (contact_id: string): Promise<Pet[]> =>
      sendToWorker({ type: 'GET_PETS', payload: { contact_id } }),
    createPet: (p: Omit<Pet, 'id' | 'created_at'>): Promise<Pet> =>
      sendToWorker({ type: 'CREATE_PET', payload: p }),
    updatePet: (p: Partial<Pet> & { id: string }): Promise<Pet> =>
      sendToWorker({ type: 'UPDATE_PET', payload: p }),
    deletePet: (id: string): Promise<null> => sendToWorker({ type: 'DELETE_PET', payload: { id } }),

    // ── Tags ──────────────────────────────────────────────────────────────────
    getTags: (vault_id: string): Promise<Tag[]> =>
      sendToWorker({ type: 'GET_TAGS', payload: { vault_id } }),
    createTag: (p: Omit<Tag, 'id'>): Promise<Tag> =>
      sendToWorker({ type: 'CREATE_TAG', payload: p }),
    updateTag: (p: Partial<Tag> & { id: string }): Promise<Tag> =>
      sendToWorker({ type: 'UPDATE_TAG', payload: p }),
    deleteTag: (id: string): Promise<null> => sendToWorker({ type: 'DELETE_TAG', payload: { id } }),
    setContactTags: (contact_id: string, tag_ids: string[]): Promise<null> =>
      sendToWorker({ type: 'SET_CONTACT_TAGS', payload: { contact_id, tag_ids } }),

    // ── Groups ────────────────────────────────────────────────────────────────
    getGroups: (vault_id: string): Promise<GroupWithCount[]> =>
      sendToWorker({ type: 'GET_GROUPS', payload: { vault_id } }),
    getGroup: (id: string): Promise<Group> => sendToWorker({ type: 'GET_GROUP', payload: { id } }),
    createGroup: (p: Omit<Group, 'id' | 'created_at'>): Promise<Group> =>
      sendToWorker({ type: 'CREATE_GROUP', payload: p }),
    updateGroup: (p: Partial<Group> & { id: string }): Promise<Group> =>
      sendToWorker({ type: 'UPDATE_GROUP', payload: p }),
    deleteGroup: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_GROUP', payload: { id } }),
    addToGroup: (group_id: string, contact_id: string): Promise<null> =>
      sendToWorker({ type: 'ADD_TO_GROUP', payload: { group_id, contact_id } }),
    removeFromGroup: (group_id: string, contact_id: string): Promise<null> =>
      sendToWorker({ type: 'REMOVE_FROM_GROUP', payload: { group_id, contact_id } }),
    getGroupContacts: (group_id: string): Promise<Contact[]> =>
      sendToWorker({ type: 'GET_GROUP_CONTACTS', payload: { group_id } }),

    // ── Interactions ──────────────────────────────────────────────────────────
    getInteractions: (
      vault_id: string,
      contact_id?: string,
      limit?: number,
    ): Promise<InteractionWithContacts[]> =>
      sendToWorker({ type: 'GET_INTERACTIONS', payload: { vault_id, contact_id, limit } }),
    getInteraction: (id: string): Promise<InteractionWithContacts> =>
      sendToWorker({ type: 'GET_INTERACTION', payload: { id } }),
    createInteraction: (
      p: Omit<Interaction, 'id' | 'created_at' | 'updated_at'> & { contact_ids: string[] },
    ): Promise<InteractionWithContacts> => sendToWorker({ type: 'CREATE_INTERACTION', payload: p }),
    updateInteraction: (
      p: Partial<Interaction> & { id: string } & { contact_ids?: string[] },
    ): Promise<InteractionWithContacts> => sendToWorker({ type: 'UPDATE_INTERACTION', payload: p }),
    deleteInteraction: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_INTERACTION', payload: { id } }),

    // ── Notes ─────────────────────────────────────────────────────────────────
    getNotes: (contact_id: string): Promise<Note[]> =>
      sendToWorker({ type: 'GET_NOTES', payload: { contact_id } }),
    createNote: (p: Omit<Note, 'id' | 'created_at' | 'updated_at'>): Promise<Note> =>
      sendToWorker({ type: 'CREATE_NOTE', payload: p }),
    updateNote: (p: Partial<Note> & { id: string }): Promise<Note> =>
      sendToWorker({ type: 'UPDATE_NOTE', payload: p }),
    deleteNote: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_NOTE', payload: { id } }),
    togglePinNote: (id: string): Promise<Note> =>
      sendToWorker({ type: 'TOGGLE_PIN_NOTE', payload: { id } }),

    // ── Life event types ──────────────────────────────────────────────────────
    getLifeEventTypes: (vault_id: string): Promise<LifeEventType[]> =>
      sendToWorker({ type: 'GET_LIFE_EVENT_TYPES', payload: { vault_id } }),
    createLifeEventType: (p: Omit<LifeEventType, 'id'>): Promise<LifeEventType> =>
      sendToWorker({ type: 'CREATE_LIFE_EVENT_TYPE', payload: p }),

    // ── Life events ───────────────────────────────────────────────────────────
    getLifeEvents: (contact_id: string): Promise<LifeEvent[]> =>
      sendToWorker({ type: 'GET_LIFE_EVENTS', payload: { contact_id } }),
    createLifeEvent: (p: Omit<LifeEvent, 'id' | 'created_at'>): Promise<LifeEvent> =>
      sendToWorker({ type: 'CREATE_LIFE_EVENT', payload: p }),
    updateLifeEvent: (p: Partial<LifeEvent> & { id: string }): Promise<LifeEvent> =>
      sendToWorker({ type: 'UPDATE_LIFE_EVENT', payload: p }),
    deleteLifeEvent: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_LIFE_EVENT', payload: { id } }),

    // ── Reminders ─────────────────────────────────────────────────────────────
    getReminders: (contact_id: string): Promise<Reminder[]> =>
      sendToWorker({ type: 'GET_REMINDERS', payload: { contact_id } }),
    getUpcomingReminders: (
      vault_id: string,
      days: number,
    ): Promise<Array<{ contact: Contact; reminder: Reminder; days_away: number }>> =>
      sendToWorker({ type: 'GET_UPCOMING_REMINDERS', payload: { vault_id, days } }),
    createReminder: (
      p: Omit<Reminder, 'id' | 'created_at' | 'is_done' | 'done_at'>,
    ): Promise<Reminder> => sendToWorker({ type: 'CREATE_REMINDER', payload: p }),
    updateReminder: (p: Partial<Reminder> & { id: string }): Promise<Reminder> =>
      sendToWorker({ type: 'UPDATE_REMINDER', payload: p }),
    doneReminder: (id: string): Promise<Reminder> =>
      sendToWorker({ type: 'DONE_REMINDER', payload: { id } }),
    deleteReminder: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_REMINDER', payload: { id } }),

    // ── Stay-in-touch ─────────────────────────────────────────────────────────
    getStayInTouch: (contact_id: string): Promise<StayInTouch | null> =>
      sendToWorker({ type: 'GET_STAY_IN_TOUCH', payload: { contact_id } }),
    getOverdueStayInTouch: (vault_id: string): Promise<StayInTouchWithContact[]> =>
      sendToWorker({ type: 'GET_OVERDUE_STAY_IN_TOUCH', payload: { vault_id } }),
    setStayInTouch: (contact_id: string, frequency_days: number): Promise<StayInTouch> =>
      sendToWorker({ type: 'SET_STAY_IN_TOUCH', payload: { contact_id, frequency_days } }),
    removeStayInTouch: (contact_id: string): Promise<null> =>
      sendToWorker({ type: 'REMOVE_STAY_IN_TOUCH', payload: { contact_id } }),
    markContacted: (contact_id: string): Promise<null> =>
      sendToWorker({ type: 'MARK_CONTACTED', payload: { contact_id } }),

    // ── Tasks ─────────────────────────────────────────────────────────────────
    getTasks: (contact_id: string): Promise<Task[]> =>
      sendToWorker({ type: 'GET_TASKS', payload: { contact_id } }),
    createTask: (
      p: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at'>,
    ): Promise<Task> => sendToWorker({ type: 'CREATE_TASK', payload: p }),
    updateTask: (p: Partial<Task> & { id: string }): Promise<Task> =>
      sendToWorker({ type: 'UPDATE_TASK', payload: p }),
    toggleTask: (id: string): Promise<Task> =>
      sendToWorker({ type: 'TOGGLE_TASK', payload: { id } }),
    deleteTask: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_TASK', payload: { id } }),

    // ── Gift notes ────────────────────────────────────────────────────────────
    getGiftNotes: (contact_id: string): Promise<GiftNote[]> =>
      sendToWorker({ type: 'GET_GIFT_NOTES', payload: { contact_id } }),
    createGiftNote: (
      p: Omit<GiftNote, 'id' | 'created_at' | 'is_given' | 'given_at'>,
    ): Promise<GiftNote> => sendToWorker({ type: 'CREATE_GIFT_NOTE', payload: p }),
    updateGiftNote: (p: Partial<GiftNote> & { id: string }): Promise<GiftNote> =>
      sendToWorker({ type: 'UPDATE_GIFT_NOTE', payload: p }),
    markGiftGiven: (id: string): Promise<GiftNote> =>
      sendToWorker({ type: 'MARK_GIFT_GIVEN', payload: { id } }),
    deleteGiftNote: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_GIFT_NOTE', payload: { id } }),

    // ── Journal ───────────────────────────────────────────────────────────────
    getJournalEntries: (vault_id: string): Promise<JournalEntry[]> =>
      sendToWorker({ type: 'GET_JOURNAL_ENTRIES', payload: { vault_id } }),
    getJournalEntry: (date: string, vault_id: string): Promise<JournalEntry | null> =>
      sendToWorker({ type: 'GET_JOURNAL_ENTRY', payload: { date, vault_id } }),
    upsertJournalEntry: (
      p: Omit<JournalEntry, 'id' | 'created_at' | 'updated_at'>,
    ): Promise<JournalEntry> => sendToWorker({ type: 'UPSERT_JOURNAL_ENTRY', payload: p }),
    deleteJournalEntry: (id: string): Promise<null> =>
      sendToWorker({ type: 'DELETE_JOURNAL_ENTRY', payload: { id } }),

    // ── Search ────────────────────────────────────────────────────────────────
    search: (vault_id: string, query: string): Promise<SearchResult> =>
      sendToWorker({ type: 'SEARCH', payload: { vault_id, query } }),

    // ── Dashboard ─────────────────────────────────────────────────────────────
    getDashboard: (vault_id: string): Promise<DashboardData> =>
      sendToWorker({ type: 'GET_DASHBOARD', payload: { vault_id } }),

    // ── Export ────────────────────────────────────────────────────────────────
    exportVault: (vault_id: string): Promise<HalcyonExport> =>
      sendToWorker({ type: 'EXPORT_VAULT', payload: { vault_id } }),
  }
}
