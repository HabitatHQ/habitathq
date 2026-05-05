import * as parse from '~/lib/db-parsers'
import type {
  Address,
  AddressType,
  Company,
  Contact,
  ContactDetail,
  ContactField,
  ContactFieldType,
  ContactFieldWithType,
  DashboardData,
  DbAdapter,
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
  RelationshipWithContact,
  Reminder,
  SearchResult,
  StayInTouch,
  StayInTouchWithContact,
  Tag,
  Task,
  Vault,
  WorkerRequestBody,
} from '~/types/database'
import { stayInTouchNextDate } from '~/utils/reminder-helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

// ─── Internal helpers ────────────────────────────────────────────────────────

async function getInteractionContacts(db: DbAdapter, interactionId: string): Promise<Contact[]> {
  const rows = await db.queryAll(
    `SELECT c.* FROM contacts c
     JOIN interaction_contacts ic ON ic.contact_id = c.id
     WHERE ic.interaction_id = ?`,
    [interactionId],
  )
  return rows.map(parse.rowToContact)
}

async function touchContacts(db: DbAdapter, contactIds: string[]): Promise<void> {
  const ts = now()
  for (const id of contactIds) {
    await db.exec('UPDATE contacts SET last_contacted_at = ?, updated_at = ? WHERE id = ?', [
      ts,
      ts,
      id,
    ])
    // Reset stay-in-touch
    const sit = await db.queryAll('SELECT * FROM stay_in_touch WHERE contact_id = ?', [id])
    if (sit.length > 0) {
      const next = stayInTouchNextDate({
        frequency_days: (sit[0] as { frequency_days: number }).frequency_days,
        last_contacted_at: ts,
      })
      await db.exec(
        `UPDATE stay_in_touch SET last_contacted_at = ?, next_remind_at = ?, updated_at = ?
         WHERE contact_id = ?`,
        [ts, next, ts, id],
      )
    }
  }
}

async function syncContactFts(db: DbAdapter, contact: Contact): Promise<void> {
  await db.exec('DELETE FROM contacts_fts WHERE id = ?', [contact.id])
  await db.exec(
    'INSERT INTO contacts_fts (id, first_name, last_name, nickname) VALUES (?, ?, ?, ?)',
    [contact.id, contact.first_name, contact.last_name, contact.nickname],
  )
}

async function syncNoteFts(db: DbAdapter, note: Note): Promise<void> {
  await db.exec('DELETE FROM notes_fts WHERE id = ?', [note.id])
  await db.exec('INSERT INTO notes_fts (id, contact_id, body) VALUES (?, ?, ?)', [
    note.id,
    note.contact_id,
    note.body,
  ])
}

// ─── VAULTS ──────────────────────────────────────────────────────────────────

export async function getVaults(db: DbAdapter): Promise<Vault[]> {
  const rows = await db.queryAll('SELECT * FROM vaults ORDER BY name')
  return rows.map(parse.rowToVault)
}

export async function createVault(
  db: DbAdapter,
  p: Omit<Vault, 'id' | 'created_at'>,
): Promise<Vault> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO vaults (id, name, description, color, icon, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.name, p.description, p.color, p.icon, ts],
  )
  await seedDefaultFieldTypes(db, id)
  await seedDefaultRelationshipTypes(db, id)
  await seedDefaultAddressTypes(db, id)
  await seedDefaultLifeEventTypes(db, id)
  const rows = await db.queryAll('SELECT * FROM vaults WHERE id = ?', [id])
  return parse.rowToVault(rows[0]!)
}

export async function updateVault(
  db: DbAdapter,
  p: Partial<Vault> & { id: string },
): Promise<Vault> {
  if (p.name !== undefined) await db.exec('UPDATE vaults SET name = ? WHERE id = ?', [p.name, p.id])
  if (p.description !== undefined)
    await db.exec('UPDATE vaults SET description = ? WHERE id = ?', [p.description, p.id])
  if (p.color !== undefined)
    await db.exec('UPDATE vaults SET color = ? WHERE id = ?', [p.color, p.id])
  if (p.icon !== undefined) await db.exec('UPDATE vaults SET icon = ? WHERE id = ?', [p.icon, p.id])
  const rows = await db.queryAll('SELECT * FROM vaults WHERE id = ?', [p.id])
  return parse.rowToVault(rows[0]!)
}

export async function deleteVault(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM vaults WHERE id = ?', [id])
}

// ─── CONTACTS ────────────────────────────────────────────────────────────────

export async function getContacts(db: DbAdapter, vault_id: string): Promise<Contact[]> {
  const rows = await db.queryAll(
    `SELECT * FROM contacts WHERE vault_id = ? AND archived_at IS NULL
     ORDER BY last_name, first_name`,
    [vault_id],
  )
  return rows.map(parse.rowToContact)
}

export async function getContact(db: DbAdapter, id: string): Promise<Contact> {
  const rows = await db.queryAll('SELECT * FROM contacts WHERE id = ?', [id])
  return parse.rowToContact(rows[0]!)
}

export async function getContactDetail(db: DbAdapter, id: string): Promise<ContactDetail> {
  const contact = await getContact(db, id)

  // Fields with type
  const fieldRows = await db.queryAll(
    `SELECT cf.*, cft.name as type_name, cft.icon as type_icon, cft.protocol as type_protocol,
            cft.vault_id as type_vault_id, cft.is_default as type_is_default
     FROM contact_fields cf
     JOIN contact_field_types cft ON cft.id = cf.type_id
     WHERE cf.contact_id = ?
     ORDER BY cft.name`,
    [id],
  )
  const fields: ContactFieldWithType[] = fieldRows.map((r) => ({
    ...parse.rowToContactField(r),
    type: {
      id: r['type_id'] as string,
      vault_id: r['type_vault_id'] as string,
      name: r['type_name'] as string,
      icon: r['type_icon'] as string,
      protocol: r['type_protocol'] as string,
      is_default: Boolean(r['type_is_default']),
    } as ContactFieldType,
  }))

  // Addresses
  const addressRows = await db.queryAll(
    'SELECT * FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC',
    [id],
  )
  const addresses = addressRows.map(parse.rowToAddress)

  // Relationships with related contact + type
  const relRows = await db.queryAll(
    `SELECT r.*, c.first_name, c.last_name, c.nickname, c.avatar_url,
            rt.name as type_name, rt.name_reverse, rt.is_symmetric
     FROM relationships r
     JOIN contacts c ON c.id = r.related_id
     JOIN relationship_types rt ON rt.id = r.type_id
     WHERE r.contact_id = ?`,
    [id],
  )
  const relationships: RelationshipWithContact[] = relRows.map((r: Record<string, unknown>) => ({
    ...parse.rowToRelationship(r),
    related: parse.rowToContact({ ...r, id: r['related_id'] }),
    type: parse.rowToRelationshipType({
      id: r['type_id'],
      vault_id: contact.vault_id,
      name: r['type_name'],
      name_reverse: r['name_reverse'],
      is_symmetric: r['is_symmetric'],
      created_at: r['created_at'],
    }),
  }))

  // Occupations
  const occRows = await db.queryAll(
    `SELECT o.*, c.name as company_name, c.website as company_website,
            c.description as company_desc, c.tags as company_tags,
            c.created_at as company_created_at, c.updated_at as company_updated_at,
            c.vault_id as company_vault_id
     FROM occupations o
     LEFT JOIN companies c ON c.id = o.company_id
     WHERE o.contact_id = ?
     ORDER BY o.is_current DESC, o.started_at DESC`,
    [id],
  )
  const occupations: OccupationWithCompany[] = occRows.map((r) => {
    const occ = parse.rowToOccupation(r)
    const company = r['company_id']
      ? ({
          id: r['company_id'] as string,
          vault_id: r['company_vault_id'] as string,
          name: r['company_name'] as string,
          website: r['company_website'] as string,
          description: r['company_desc'] as string,
          tags: parse.safeJsonParse(r['company_tags'] as string, []),
          created_at: r['company_created_at'] as string,
          updated_at: r['company_updated_at'] as string,
        } as Company)
      : null
    return { ...occ, company }
  })

  const currentOccupation = occupations.find((o) => o.is_current) ?? null
  const pastOccupations = occupations.filter((o) => !o.is_current)

  // Pets
  const petRows = await db.queryAll('SELECT * FROM pets WHERE contact_id = ? ORDER BY name', [id])
  const pets = petRows.map(parse.rowToPet)

  // Stay-in-touch
  const sitRows = await db.queryAll('SELECT * FROM stay_in_touch WHERE contact_id = ?', [id])
  const stay_in_touch = sitRows.length > 0 ? parse.rowToStayInTouch(sitRows[0]!) : null

  return {
    ...contact,
    fields,
    addresses,
    relationships,
    current_occupation: currentOccupation,
    past_occupations: pastOccupations,
    pets,
    stay_in_touch,
  }
}

export async function createContact(
  db: DbAdapter,
  p: Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'archived_at' | 'last_contacted_at'>,
): Promise<Contact> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO contacts
     (id, vault_id, first_name, last_name, nickname, maiden_name, middle_name,
      pronouns, gender, how_we_met, is_deceased, deceased_at, birthday,
      is_starred, avatar_url, tags, annotations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.vault_id,
      p.first_name,
      p.last_name,
      p.nickname,
      p.maiden_name,
      p.middle_name,
      p.pronouns,
      p.gender,
      p.how_we_met,
      p.is_deceased ? 1 : 0,
      p.deceased_at ?? null,
      p.birthday ?? null,
      p.is_starred ? 1 : 0,
      p.avatar_url ?? null,
      JSON.stringify(p.tags),
      JSON.stringify(p.annotations),
      ts,
      ts,
    ],
  )
  const contact = await getContact(db, id)
  await syncContactFts(db, contact)
  return contact
}

export async function updateContact(
  db: DbAdapter,
  p: Partial<Contact> & { id: string },
): Promise<Contact> {
  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const vals: unknown[] = [ts]

  const maybeSet = (col: string, val: unknown) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(val)
    }
  }

  maybeSet('first_name', p.first_name)
  maybeSet('last_name', p.last_name)
  maybeSet('nickname', p.nickname)
  maybeSet('maiden_name', p.maiden_name)
  maybeSet('middle_name', p.middle_name)
  maybeSet('pronouns', p.pronouns)
  maybeSet('gender', p.gender)
  maybeSet('how_we_met', p.how_we_met)
  if (p.is_deceased !== undefined) maybeSet('is_deceased', p.is_deceased ? 1 : 0)
  maybeSet('deceased_at', p.deceased_at)
  maybeSet('birthday', p.birthday)
  if (p.is_starred !== undefined) maybeSet('is_starred', p.is_starred ? 1 : 0)
  maybeSet('avatar_url', p.avatar_url)
  if (p.tags !== undefined) maybeSet('tags', JSON.stringify(p.tags))
  if (p.annotations !== undefined) maybeSet('annotations', JSON.stringify(p.annotations))

  vals.push(p.id)
  await db.exec(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`, vals)
  const contact = await getContact(db, p.id)
  await syncContactFts(db, contact)
  return contact
}

export async function archiveContact(db: DbAdapter, id: string): Promise<void> {
  const ts = now()
  await db.exec('UPDATE contacts SET archived_at = ?, updated_at = ? WHERE id = ?', [ts, ts, id])
}

export async function unarchiveContact(db: DbAdapter, id: string): Promise<void> {
  await db.exec('UPDATE contacts SET archived_at = NULL, updated_at = ? WHERE id = ?', [now(), id])
}

export async function toggleStarContact(db: DbAdapter, id: string): Promise<Contact> {
  await db.exec(
    `UPDATE contacts SET is_starred = CASE WHEN is_starred = 1 THEN 0 ELSE 1 END,
     updated_at = ? WHERE id = ?`,
    [now(), id],
  )
  return getContact(db, id)
}

// ─── CONTACT FIELD TYPES ─────────────────────────────────────────────────────

export async function getContactFieldTypes(
  db: DbAdapter,
  vault_id: string,
): Promise<ContactFieldType[]> {
  const rows = await db.queryAll(
    'SELECT * FROM contact_field_types WHERE vault_id = ? ORDER BY name',
    [vault_id],
  )
  return rows.map(parse.rowToContactFieldType)
}

export async function createContactFieldType(
  db: DbAdapter,
  p: Omit<ContactFieldType, 'id'>,
): Promise<ContactFieldType> {
  const id = uuid()
  await db.exec(
    `INSERT INTO contact_field_types (id, vault_id, name, icon, protocol, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.vault_id, p.name, p.icon, p.protocol, p.is_default ? 1 : 0],
  )
  const rows = await db.queryAll('SELECT * FROM contact_field_types WHERE id = ?', [id])
  return parse.rowToContactFieldType(rows[0]!)
}

export async function updateContactFieldType(
  db: DbAdapter,
  p: Partial<ContactFieldType> & { id: string },
): Promise<ContactFieldType> {
  if (p.name !== undefined)
    await db.exec('UPDATE contact_field_types SET name = ? WHERE id = ?', [p.name, p.id])
  if (p.icon !== undefined)
    await db.exec('UPDATE contact_field_types SET icon = ? WHERE id = ?', [p.icon, p.id])
  if (p.protocol !== undefined)
    await db.exec('UPDATE contact_field_types SET protocol = ? WHERE id = ?', [p.protocol, p.id])
  const rows = await db.queryAll('SELECT * FROM contact_field_types WHERE id = ?', [p.id])
  return parse.rowToContactFieldType(rows[0]!)
}

export async function deleteContactFieldType(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM contact_field_types WHERE id = ?', [id])
}

// ─── CONTACT FIELDS ──────────────────────────────────────────────────────────

export async function createContactField(
  db: DbAdapter,
  p: Omit<ContactField, 'id' | 'created_at'>,
): Promise<ContactField> {
  const id = uuid()
  await db.exec(
    `INSERT INTO contact_fields (id, contact_id, type_id, value, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.contact_id, p.type_id, p.value, p.label, now()],
  )
  const rows = await db.queryAll('SELECT * FROM contact_fields WHERE id = ?', [id])
  return parse.rowToContactField(rows[0]!)
}

export async function updateContactField(
  db: DbAdapter,
  p: Partial<ContactField> & { id: string },
): Promise<ContactField> {
  if (p.value !== undefined)
    await db.exec('UPDATE contact_fields SET value = ? WHERE id = ?', [p.value, p.id])
  if (p.label !== undefined)
    await db.exec('UPDATE contact_fields SET label = ? WHERE id = ?', [p.label, p.id])
  const rows = await db.queryAll('SELECT * FROM contact_fields WHERE id = ?', [p.id])
  return parse.rowToContactField(rows[0]!)
}

export async function deleteContactField(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM contact_fields WHERE id = ?', [id])
}

// ─── ADDRESSES ───────────────────────────────────────────────────────────────

export async function getAddressTypes(db: DbAdapter, vault_id: string): Promise<AddressType[]> {
  const rows = await db.queryAll('SELECT * FROM address_types WHERE vault_id = ? ORDER BY name', [
    vault_id,
  ])
  return rows.map(parse.rowToAddressType)
}

export async function createAddressType(db: DbAdapter, p: Omit<AddressType, 'id'>): Promise<void> {
  await db.exec('INSERT INTO address_types (id, vault_id, name) VALUES (?, ?, ?)', [
    uuid(),
    p.vault_id,
    p.name,
  ])
}

export async function createAddress(
  db: DbAdapter,
  p: Omit<Address, 'id' | 'created_at'>,
): Promise<Address> {
  const id = uuid()
  await db.exec(
    `INSERT INTO addresses (id, contact_id, type_id, street, city, province, postal_code, country, is_primary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.contact_id,
      p.type_id ?? null,
      p.street,
      p.city,
      p.province,
      p.postal_code,
      p.country,
      p.is_primary ? 1 : 0,
      now(),
    ],
  )
  const rows = await db.queryAll('SELECT * FROM addresses WHERE id = ?', [id])
  return parse.rowToAddress(rows[0]!)
}

export async function updateAddress(
  db: DbAdapter,
  p: Partial<Address> & { id: string },
): Promise<Address> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('street', p.street)
  s('city', p.city)
  s('province', p.province)
  s('postal_code', p.postal_code)
  s('country', p.country)
  if (p.is_primary !== undefined) {
    fields.push('is_primary = ?')
    vals.push(p.is_primary ? 1 : 0)
  }
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE addresses SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM addresses WHERE id = ?', [p.id])
  return parse.rowToAddress(rows[0]!)
}

export async function deleteAddress(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM addresses WHERE id = ?', [id])
}

// ─── RELATIONSHIP TYPES ─────────────────────────────────────────────────────

export async function getRelationshipTypes(
  db: DbAdapter,
  vault_id: string,
): Promise<RelationshipType[]> {
  const rows = await db.queryAll(
    'SELECT * FROM relationship_types WHERE vault_id = ? ORDER BY name',
    [vault_id],
  )
  return rows.map(parse.rowToRelationshipType)
}

export async function createRelationshipType(
  db: DbAdapter,
  p: Omit<RelationshipType, 'id' | 'created_at'>,
): Promise<RelationshipType> {
  const id = uuid()
  await db.exec(
    `INSERT INTO relationship_types (id, vault_id, name, name_reverse, is_symmetric, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.vault_id, p.name, p.name_reverse, p.is_symmetric ? 1 : 0, now()],
  )
  const rows = await db.queryAll('SELECT * FROM relationship_types WHERE id = ?', [id])
  return parse.rowToRelationshipType(rows[0]!)
}

export async function updateRelationshipType(
  db: DbAdapter,
  p: Partial<RelationshipType> & { id: string },
): Promise<RelationshipType> {
  if (p.name !== undefined)
    await db.exec('UPDATE relationship_types SET name = ? WHERE id = ?', [p.name, p.id])
  if (p.name_reverse !== undefined)
    await db.exec('UPDATE relationship_types SET name_reverse = ? WHERE id = ?', [
      p.name_reverse,
      p.id,
    ])
  const rows = await db.queryAll('SELECT * FROM relationship_types WHERE id = ?', [p.id])
  return parse.rowToRelationshipType(rows[0]!)
}

export async function deleteRelationshipType(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM relationship_types WHERE id = ?', [id])
}

// ─── RELATIONSHIPS ───────────────────────────────────────────────────────────

export async function createRelationship(
  db: DbAdapter,
  p: Omit<Relationship, 'id' | 'created_at'>,
): Promise<Relationship> {
  const id = uuid()
  await db.exec(
    `INSERT INTO relationships (id, contact_id, related_id, type_id, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.contact_id, p.related_id, p.type_id, p.notes, now()],
  )
  const rows = await db.queryAll('SELECT * FROM relationships WHERE id = ?', [id])
  return parse.rowToRelationship(rows[0]!)
}

export async function deleteRelationship(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM relationships WHERE id = ?', [id])
}

// ─── COMPANIES ───────────────────────────────────────────────────────────────

export async function getCompanies(db: DbAdapter, vault_id: string): Promise<Company[]> {
  const rows = await db.queryAll('SELECT * FROM companies WHERE vault_id = ? ORDER BY name', [
    vault_id,
  ])
  return rows.map(parse.rowToCompany)
}

export async function getCompany(db: DbAdapter, id: string): Promise<Company> {
  const rows = await db.queryAll('SELECT * FROM companies WHERE id = ?', [id])
  return parse.rowToCompany(rows[0]!)
}

export async function getCompanyContacts(db: DbAdapter, company_id: string): Promise<Contact[]> {
  const rows = await db.queryAll(
    `SELECT c.* FROM contacts c
     JOIN occupations o ON o.contact_id = c.id
     WHERE o.company_id = ? AND c.archived_at IS NULL
     GROUP BY c.id`,
    [company_id],
  )
  return rows.map(parse.rowToContact)
}

export async function createCompany(
  db: DbAdapter,
  p: Omit<Company, 'id' | 'created_at' | 'updated_at'>,
): Promise<Company> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO companies (id, vault_id, name, website, description, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, p.vault_id, p.name, p.website, p.description, JSON.stringify(p.tags), ts, ts],
  )
  return getCompany(db, id)
}

export async function updateCompany(
  db: DbAdapter,
  p: Partial<Company> & { id: string },
): Promise<Company> {
  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const vals: unknown[] = [ts]
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('name', p.name)
  s('website', p.website)
  s('description', p.description)
  if (p.tags !== undefined) {
    fields.push('tags = ?')
    vals.push(JSON.stringify(p.tags))
  }
  vals.push(p.id)
  await db.exec(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`, vals)
  return getCompany(db, p.id)
}

export async function deleteCompany(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM companies WHERE id = ?', [id])
}

// ─── OCCUPATIONS ─────────────────────────────────────────────────────────────

export async function getOccupations(
  db: DbAdapter,
  contact_id: string,
): Promise<OccupationWithCompany[]> {
  const rows = await db.queryAll(
    `SELECT o.*, c.name as company_name, c.website as company_website,
            c.description as company_desc, c.tags as company_tags,
            c.created_at as company_created_at, c.updated_at as company_updated_at,
            c.vault_id as company_vault_id
     FROM occupations o LEFT JOIN companies c ON c.id = o.company_id
     WHERE o.contact_id = ? ORDER BY o.is_current DESC, o.started_at DESC`,
    [contact_id],
  )
  return rows.map((r) => ({
    ...parse.rowToOccupation(r),
    company: r['company_id']
      ? ({
          id: r['company_id'] as string,
          vault_id: r['company_vault_id'] as string,
          name: r['company_name'] as string,
          website: r['company_website'] as string,
          description: r['company_desc'] as string,
          tags: parse.safeJsonParse(r['company_tags'] as string, []),
          created_at: r['company_created_at'] as string,
          updated_at: r['company_updated_at'] as string,
        } as Company)
      : null,
  }))
}

export async function createOccupation(
  db: DbAdapter,
  p: Omit<Occupation, 'id' | 'created_at'>,
): Promise<Occupation> {
  const id = uuid()
  await db.exec(
    `INSERT INTO occupations (id, contact_id, company_id, title, department, is_current, started_at, ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.contact_id,
      p.company_id ?? null,
      p.title,
      p.department,
      p.is_current ? 1 : 0,
      p.started_at ?? null,
      p.ended_at ?? null,
      now(),
    ],
  )
  const rows = await db.queryAll('SELECT * FROM occupations WHERE id = ?', [id])
  return parse.rowToOccupation(rows[0]!)
}

export async function updateOccupation(
  db: DbAdapter,
  p: Partial<Occupation> & { id: string },
): Promise<Occupation> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('title', p.title)
  s('department', p.department)
  s('company_id', p.company_id)
  s('started_at', p.started_at)
  s('ended_at', p.ended_at)
  if (p.is_current !== undefined) {
    fields.push('is_current = ?')
    vals.push(p.is_current ? 1 : 0)
  }
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE occupations SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM occupations WHERE id = ?', [p.id])
  return parse.rowToOccupation(rows[0]!)
}

export async function deleteOccupation(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM occupations WHERE id = ?', [id])
}

// ─── PETS ────────────────────────────────────────────────────────────────────

export async function getPets(db: DbAdapter, contact_id: string): Promise<Pet[]> {
  const rows = await db.queryAll('SELECT * FROM pets WHERE contact_id = ? ORDER BY name', [
    contact_id,
  ])
  return rows.map(parse.rowToPet)
}

export async function createPet(db: DbAdapter, p: Omit<Pet, 'id' | 'created_at'>): Promise<Pet> {
  const id = uuid()
  await db.exec(
    'INSERT INTO pets (id, contact_id, name, species, breed, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, p.contact_id, p.name, p.species, p.breed, now()],
  )
  const rows = await db.queryAll('SELECT * FROM pets WHERE id = ?', [id])
  return parse.rowToPet(rows[0]!)
}

export async function updatePet(db: DbAdapter, p: Partial<Pet> & { id: string }): Promise<Pet> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('name', p.name)
  s('species', p.species)
  s('breed', p.breed)
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE pets SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM pets WHERE id = ?', [p.id])
  return parse.rowToPet(rows[0]!)
}

export async function deletePet(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM pets WHERE id = ?', [id])
}

// ─── TAGS ────────────────────────────────────────────────────────────────────

export async function getTags(db: DbAdapter, vault_id: string): Promise<Tag[]> {
  const rows = await db.queryAll('SELECT * FROM tags WHERE vault_id = ? ORDER BY name', [vault_id])
  return rows.map(parse.rowToTag)
}

export async function createTag(db: DbAdapter, p: Omit<Tag, 'id'>): Promise<Tag> {
  const id = uuid()
  await db.exec('INSERT INTO tags (id, vault_id, name, color) VALUES (?, ?, ?, ?)', [
    id,
    p.vault_id,
    p.name,
    p.color,
  ])
  const rows = await db.queryAll('SELECT * FROM tags WHERE id = ?', [id])
  return parse.rowToTag(rows[0]!)
}

export async function updateTag(db: DbAdapter, p: Partial<Tag> & { id: string }): Promise<Tag> {
  if (p.name !== undefined) await db.exec('UPDATE tags SET name = ? WHERE id = ?', [p.name, p.id])
  if (p.color !== undefined)
    await db.exec('UPDATE tags SET color = ? WHERE id = ?', [p.color, p.id])
  const rows = await db.queryAll('SELECT * FROM tags WHERE id = ?', [p.id])
  return parse.rowToTag(rows[0]!)
}

export async function deleteTag(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM tags WHERE id = ?', [id])
}

export async function setContactTags(
  db: DbAdapter,
  contact_id: string,
  tag_ids: string[],
): Promise<void> {
  await db.exec('DELETE FROM contact_tags WHERE contact_id = ?', [contact_id])
  for (const tag_id of tag_ids) {
    await db.exec('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', [
      contact_id,
      tag_id,
    ])
  }
}

// ─── GROUPS ──────────────────────────────────────────────────────────────────

export async function getGroups(db: DbAdapter, vault_id: string): Promise<GroupWithCount[]> {
  const rows = await db.queryAll(
    `SELECT g.*, COUNT(gc.contact_id) as member_count
     FROM groups g LEFT JOIN group_contacts gc ON gc.group_id = g.id
     WHERE g.vault_id = ? GROUP BY g.id ORDER BY g.name`,
    [vault_id],
  )
  return rows.map((r) => ({
    ...parse.rowToGroup(r),
    member_count: r['member_count'] as number,
  }))
}

export async function getGroup(db: DbAdapter, id: string): Promise<Group> {
  const rows = await db.queryAll('SELECT * FROM groups WHERE id = ?', [id])
  return parse.rowToGroup(rows[0]!)
}

export async function createGroup(
  db: DbAdapter,
  p: Omit<Group, 'id' | 'created_at'>,
): Promise<Group> {
  const id = uuid()
  await db.exec(
    'INSERT INTO groups (id, vault_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, p.vault_id, p.name, p.description, now()],
  )
  const rows = await db.queryAll('SELECT * FROM groups WHERE id = ?', [id])
  return parse.rowToGroup(rows[0]!)
}

export async function updateGroup(
  db: DbAdapter,
  p: Partial<Group> & { id: string },
): Promise<Group> {
  if (p.name !== undefined) await db.exec('UPDATE groups SET name = ? WHERE id = ?', [p.name, p.id])
  if (p.description !== undefined)
    await db.exec('UPDATE groups SET description = ? WHERE id = ?', [p.description, p.id])
  const rows = await db.queryAll('SELECT * FROM groups WHERE id = ?', [p.id])
  return parse.rowToGroup(rows[0]!)
}

export async function deleteGroup(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM groups WHERE id = ?', [id])
}

export async function addToGroup(
  db: DbAdapter,
  group_id: string,
  contact_id: string,
): Promise<void> {
  await db.exec('INSERT OR IGNORE INTO group_contacts VALUES (?, ?)', [group_id, contact_id])
}

export async function removeFromGroup(
  db: DbAdapter,
  group_id: string,
  contact_id: string,
): Promise<void> {
  await db.exec('DELETE FROM group_contacts WHERE group_id = ? AND contact_id = ?', [
    group_id,
    contact_id,
  ])
}

export async function getGroupContacts(db: DbAdapter, group_id: string): Promise<Contact[]> {
  const rows = await db.queryAll(
    `SELECT c.* FROM contacts c
     JOIN group_contacts gc ON gc.contact_id = c.id
     WHERE gc.group_id = ? AND c.archived_at IS NULL
     ORDER BY c.last_name, c.first_name`,
    [group_id],
  )
  return rows.map(parse.rowToContact)
}

// ─── INTERACTIONS ────────────────────────────────────────────────────────────

export async function getInteractions(
  db: DbAdapter,
  vault_id: string,
  contact_id?: string,
  limit = 50,
): Promise<InteractionWithContacts[]> {
  let sql: string
  let bind: unknown[]

  if (contact_id) {
    sql = `SELECT DISTINCT i.* FROM interactions i
           JOIN interaction_contacts ic ON ic.interaction_id = i.id
           WHERE i.vault_id = ? AND ic.contact_id = ?
           ORDER BY i.happened_at DESC LIMIT ?`
    bind = [vault_id, contact_id, limit]
  } else {
    sql = `SELECT * FROM interactions WHERE vault_id = ?
           ORDER BY happened_at DESC LIMIT ?`
    bind = [vault_id, limit]
  }

  const rows = await db.queryAll(sql, bind)
  const results: InteractionWithContacts[] = []
  for (const r of rows) {
    const interaction = parse.rowToInteraction(r)
    const contacts = await getInteractionContacts(db, interaction.id)
    results.push({ ...interaction, contacts })
  }
  return results
}

export async function getInteraction(db: DbAdapter, id: string): Promise<InteractionWithContacts> {
  const rows = await db.queryAll('SELECT * FROM interactions WHERE id = ?', [id])
  const interaction = parse.rowToInteraction(rows[0]!)
  const contacts = await getInteractionContacts(db, id)
  return { ...interaction, contacts }
}

export async function createInteraction(
  db: DbAdapter,
  p: Omit<Interaction, 'id' | 'created_at' | 'updated_at'> & { contact_ids: string[] },
): Promise<InteractionWithContacts> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO interactions (id, vault_id, type, channel, subject, notes, happened_at, duration_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.vault_id,
      p.type,
      p.channel ?? null,
      p.subject,
      p.notes,
      p.happened_at,
      p.duration_minutes ?? null,
      ts,
      ts,
    ],
  )
  for (const contact_id of p.contact_ids) {
    await db.exec(
      'INSERT OR IGNORE INTO interaction_contacts (interaction_id, contact_id) VALUES (?, ?)',
      [id, contact_id],
    )
  }
  await touchContacts(db, p.contact_ids)
  const rows = await db.queryAll('SELECT * FROM interactions WHERE id = ?', [id])
  const interaction = parse.rowToInteraction(rows[0]!)
  const contacts = await getInteractionContacts(db, id)
  return { ...interaction, contacts }
}

export async function updateInteraction(
  db: DbAdapter,
  p: Partial<Interaction> & { id: string } & { contact_ids?: string[] },
): Promise<InteractionWithContacts> {
  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const vals: unknown[] = [ts]
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('type', p.type)
  s('channel', p.channel)
  s('subject', p.subject)
  s('notes', p.notes)
  s('happened_at', p.happened_at)
  s('duration_minutes', p.duration_minutes)
  vals.push(p.id)
  await db.exec(`UPDATE interactions SET ${fields.join(', ')} WHERE id = ?`, vals)

  if (p.contact_ids !== undefined) {
    await db.exec('DELETE FROM interaction_contacts WHERE interaction_id = ?', [p.id])
    for (const contact_id of p.contact_ids) {
      await db.exec('INSERT OR IGNORE INTO interaction_contacts VALUES (?, ?)', [p.id, contact_id])
    }
    await touchContacts(db, p.contact_ids)
  }

  const rows = await db.queryAll('SELECT * FROM interactions WHERE id = ?', [p.id])
  const interaction = parse.rowToInteraction(rows[0]!)
  const contacts = await getInteractionContacts(db, p.id)
  return { ...interaction, contacts }
}

export async function deleteInteraction(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM interactions WHERE id = ?', [id])
}

// ─── NOTES ───────────────────────────────────────────────────────────────────

export async function getNotes(db: DbAdapter, contact_id: string): Promise<Note[]> {
  const rows = await db.queryAll(
    'SELECT * FROM notes WHERE contact_id = ? ORDER BY is_pinned DESC, updated_at DESC',
    [contact_id],
  )
  return rows.map(parse.rowToNote)
}

export async function createNote(
  db: DbAdapter,
  p: Omit<Note, 'id' | 'created_at' | 'updated_at'>,
): Promise<Note> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO notes (id, contact_id, body, is_pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, p.contact_id, p.body, p.is_pinned ? 1 : 0, ts, ts],
  )
  const rows = await db.queryAll('SELECT * FROM notes WHERE id = ?', [id])
  const note = parse.rowToNote(rows[0]!)
  await syncNoteFts(db, note)
  return note
}

export async function updateNote(db: DbAdapter, p: Partial<Note> & { id: string }): Promise<Note> {
  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const vals: unknown[] = [ts]
  if (p.body !== undefined) {
    fields.push('body = ?')
    vals.push(p.body)
  }
  if (p.is_pinned !== undefined) {
    fields.push('is_pinned = ?')
    vals.push(p.is_pinned ? 1 : 0)
  }
  vals.push(p.id)
  await db.exec(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, vals)
  const rows = await db.queryAll('SELECT * FROM notes WHERE id = ?', [p.id])
  const note = parse.rowToNote(rows[0]!)
  await syncNoteFts(db, note)
  return note
}

export async function deleteNote(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM notes WHERE id = ?', [id])
  // Clean up FTS — note is already deleted so we pass a minimal object
  await db.exec('DELETE FROM notes_fts WHERE id = ?', [id])
}

export async function togglePinNote(db: DbAdapter, id: string): Promise<Note> {
  await db.exec(
    `UPDATE notes SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END, updated_at = ?
     WHERE id = ?`,
    [now(), id],
  )
  const rows = await db.queryAll('SELECT * FROM notes WHERE id = ?', [id])
  return parse.rowToNote(rows[0]!)
}

// ─── LIFE EVENT TYPES ────────────────────────────────────────────────────────

export async function getLifeEventTypes(db: DbAdapter, vault_id: string): Promise<LifeEventType[]> {
  const rows = await db.queryAll(
    'SELECT * FROM life_event_types WHERE vault_id = ? ORDER BY name',
    [vault_id],
  )
  return rows.map(parse.rowToLifeEventType)
}

export async function createLifeEventType(
  db: DbAdapter,
  p: Omit<LifeEventType, 'id'>,
): Promise<LifeEventType> {
  const id = uuid()
  await db.exec(
    'INSERT INTO life_event_types (id, vault_id, name, icon, category) VALUES (?, ?, ?, ?, ?)',
    [id, p.vault_id, p.name, p.icon, p.category],
  )
  const rows = await db.queryAll('SELECT * FROM life_event_types WHERE id = ?', [id])
  return parse.rowToLifeEventType(rows[0]!)
}

// ─── LIFE EVENTS ─────────────────────────────────────────────────────────────

export async function getLifeEvents(db: DbAdapter, contact_id: string): Promise<LifeEvent[]> {
  const rows = await db.queryAll(
    'SELECT * FROM life_events WHERE contact_id = ? ORDER BY happened_at DESC',
    [contact_id],
  )
  return rows.map(parse.rowToLifeEvent)
}

export async function createLifeEvent(
  db: DbAdapter,
  p: Omit<LifeEvent, 'id' | 'created_at'>,
): Promise<LifeEvent> {
  const id = uuid()
  await db.exec(
    `INSERT INTO life_events (id, contact_id, type_id, label, notes, happened_at, yearly_reminder, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.contact_id,
      p.type_id ?? null,
      p.label,
      p.notes,
      p.happened_at ?? null,
      p.yearly_reminder ? 1 : 0,
      now(),
    ],
  )
  const rows = await db.queryAll('SELECT * FROM life_events WHERE id = ?', [id])
  return parse.rowToLifeEvent(rows[0]!)
}

export async function updateLifeEvent(
  db: DbAdapter,
  p: Partial<LifeEvent> & { id: string },
): Promise<LifeEvent> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('label', p.label)
  s('notes', p.notes)
  s('happened_at', p.happened_at)
  if (p.yearly_reminder !== undefined) {
    fields.push('yearly_reminder = ?')
    vals.push(p.yearly_reminder ? 1 : 0)
  }
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE life_events SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM life_events WHERE id = ?', [p.id])
  return parse.rowToLifeEvent(rows[0]!)
}

export async function deleteLifeEvent(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM life_events WHERE id = ?', [id])
}

// ─── REMINDERS ───────────────────────────────────────────────────────────────

export async function getReminders(db: DbAdapter, contact_id: string): Promise<Reminder[]> {
  const rows = await db.queryAll(
    'SELECT * FROM reminders WHERE contact_id = ? ORDER BY remind_at',
    [contact_id],
  )
  return rows.map(parse.rowToReminder)
}

export async function getUpcomingReminders(
  db: DbAdapter,
  vault_id: string,
  days: number,
): Promise<Array<{ contact: Contact; reminder: Reminder; days_away: number }>> {
  const today = new Date().toISOString().slice(0, 10)
  const future = new Date()
  future.setDate(future.getDate() + days)
  const until = future.toISOString().slice(0, 10)

  const rows = await db.queryAll(
    `SELECT r.*, c.* FROM reminders r
     JOIN contacts c ON c.id = r.contact_id
     WHERE c.vault_id = ? AND r.is_done = 0
       AND r.remind_at BETWEEN ? AND ?
     ORDER BY r.remind_at`,
    [vault_id, today, until],
  )

  return rows.map((r) => {
    const reminder = parse.rowToReminder(r)
    const contact = parse.rowToContact(r)
    const daysAway = Math.round(
      (new Date(reminder.remind_at).getTime() - new Date(today).getTime()) / 86_400_000,
    )
    return { contact, reminder, days_away: daysAway }
  })
}

export async function createReminder(
  db: DbAdapter,
  p: Omit<Reminder, 'id' | 'created_at' | 'is_done' | 'done_at'>,
): Promise<Reminder> {
  const id = uuid()
  await db.exec(
    `INSERT INTO reminders (id, contact_id, title, body, remind_at, is_yearly, is_done, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, p.contact_id, p.title, p.body, p.remind_at, p.is_yearly ? 1 : 0, now()],
  )
  const rows = await db.queryAll('SELECT * FROM reminders WHERE id = ?', [id])
  return parse.rowToReminder(rows[0]!)
}

export async function updateReminder(
  db: DbAdapter,
  p: Partial<Reminder> & { id: string },
): Promise<Reminder> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('title', p.title)
  s('body', p.body)
  s('remind_at', p.remind_at)
  if (p.is_yearly !== undefined) {
    fields.push('is_yearly = ?')
    vals.push(p.is_yearly ? 1 : 0)
  }
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM reminders WHERE id = ?', [p.id])
  return parse.rowToReminder(rows[0]!)
}

export async function doneReminder(db: DbAdapter, id: string): Promise<Reminder> {
  await db.exec('UPDATE reminders SET is_done = 1, done_at = ? WHERE id = ?', [now(), id])
  const rows = await db.queryAll('SELECT * FROM reminders WHERE id = ?', [id])
  return parse.rowToReminder(rows[0]!)
}

export async function deleteReminder(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM reminders WHERE id = ?', [id])
}

// ─── STAY-IN-TOUCH ───────────────────────────────────────────────────────────

export async function getStayInTouch(
  db: DbAdapter,
  contact_id: string,
): Promise<StayInTouch | null> {
  const rows = await db.queryAll('SELECT * FROM stay_in_touch WHERE contact_id = ?', [contact_id])
  return rows.length > 0 ? parse.rowToStayInTouch(rows[0]!) : null
}

export async function getOverdueStayInTouch(
  db: DbAdapter,
  vault_id: string,
): Promise<StayInTouchWithContact[]> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await db.queryAll(
    `SELECT s.*, c.* FROM stay_in_touch s
     JOIN contacts c ON c.id = s.contact_id
     WHERE c.vault_id = ? AND s.next_remind_at <= ? AND c.archived_at IS NULL
     ORDER BY s.next_remind_at`,
    [vault_id, today],
  )
  return rows.map((r) => ({
    ...parse.rowToStayInTouch(r),
    contact: parse.rowToContact(r),
  }))
}

export async function setStayInTouch(
  db: DbAdapter,
  contact_id: string,
  frequency_days: number,
): Promise<StayInTouch> {
  const ts = now()
  const existing = await getStayInTouch(db, contact_id)
  const next = stayInTouchNextDate({
    frequency_days,
    last_contacted_at: existing?.last_contacted_at ?? null,
  })
  if (existing) {
    await db.exec(
      `UPDATE stay_in_touch SET frequency_days = ?, next_remind_at = ?, updated_at = ?
       WHERE contact_id = ?`,
      [frequency_days, next, ts, contact_id],
    )
  } else {
    await db.exec(
      `INSERT INTO stay_in_touch (id, contact_id, frequency_days, last_contacted_at, next_remind_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      [uuid(), contact_id, frequency_days, next, ts, ts],
    )
  }
  const rows = await db.queryAll('SELECT * FROM stay_in_touch WHERE contact_id = ?', [contact_id])
  return parse.rowToStayInTouch(rows[0]!)
}

export async function removeStayInTouch(db: DbAdapter, contact_id: string): Promise<void> {
  await db.exec('DELETE FROM stay_in_touch WHERE contact_id = ?', [contact_id])
}

export async function markContacted(db: DbAdapter, contact_id: string): Promise<void> {
  await touchContacts(db, [contact_id])
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

export async function getTasks(db: DbAdapter, contact_id: string): Promise<Task[]> {
  const rows = await db.queryAll(
    'SELECT * FROM tasks WHERE contact_id = ? ORDER BY is_done, due_at, created_at',
    [contact_id],
  )
  return rows.map(parse.rowToTask)
}

export async function createTask(
  db: DbAdapter,
  p: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'is_done' | 'done_at'>,
): Promise<Task> {
  const id = uuid()
  const ts = now()
  await db.exec(
    `INSERT INTO tasks (id, contact_id, title, notes, due_at, is_done, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, p.contact_id, p.title, p.notes, p.due_at ?? null, ts, ts],
  )
  const rows = await db.queryAll('SELECT * FROM tasks WHERE id = ?', [id])
  return parse.rowToTask(rows[0]!)
}

export async function updateTask(db: DbAdapter, p: Partial<Task> & { id: string }): Promise<Task> {
  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const vals: unknown[] = [ts]
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('title', p.title)
  s('notes', p.notes)
  s('due_at', p.due_at)
  if (p.is_done !== undefined) {
    fields.push('is_done = ?')
    vals.push(p.is_done ? 1 : 0)
  }
  vals.push(p.id)
  await db.exec(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, vals)
  const rows = await db.queryAll('SELECT * FROM tasks WHERE id = ?', [p.id])
  return parse.rowToTask(rows[0]!)
}

export async function toggleTask(db: DbAdapter, id: string): Promise<Task> {
  const ts = now()
  await db.exec(
    `UPDATE tasks SET is_done = CASE WHEN is_done = 1 THEN 0 ELSE 1 END,
     done_at = CASE WHEN is_done = 0 THEN ? ELSE NULL END, updated_at = ?
     WHERE id = ?`,
    [ts, ts, id],
  )
  const rows = await db.queryAll('SELECT * FROM tasks WHERE id = ?', [id])
  return parse.rowToTask(rows[0]!)
}

export async function deleteTask(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM tasks WHERE id = ?', [id])
}

// ─── GIFT NOTES ──────────────────────────────────────────────────────────────

export async function getGiftNotes(db: DbAdapter, contact_id: string): Promise<GiftNote[]> {
  const rows = await db.queryAll(
    'SELECT * FROM gift_notes WHERE contact_id = ? ORDER BY is_given, created_at DESC',
    [contact_id],
  )
  return rows.map(parse.rowToGiftNote)
}

export async function createGiftNote(
  db: DbAdapter,
  p: Omit<GiftNote, 'id' | 'created_at' | 'is_given' | 'given_at'>,
): Promise<GiftNote> {
  const id = uuid()
  await db.exec(
    `INSERT INTO gift_notes (id, contact_id, idea, occasion, is_given, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, p.contact_id, p.idea, p.occasion, now()],
  )
  const rows = await db.queryAll('SELECT * FROM gift_notes WHERE id = ?', [id])
  return parse.rowToGiftNote(rows[0]!)
}

export async function updateGiftNote(
  db: DbAdapter,
  p: Partial<GiftNote> & { id: string },
): Promise<GiftNote> {
  const fields: string[] = []
  const vals: unknown[] = []
  const s = (col: string, v: unknown) => {
    if (v !== undefined) {
      fields.push(`${col} = ?`)
      vals.push(v)
    }
  }
  s('idea', p.idea)
  s('occasion', p.occasion)
  if (p.is_given !== undefined) {
    fields.push('is_given = ?')
    vals.push(p.is_given ? 1 : 0)
  }
  if (fields.length > 0) {
    vals.push(p.id)
    await db.exec(`UPDATE gift_notes SET ${fields.join(', ')} WHERE id = ?`, vals)
  }
  const rows = await db.queryAll('SELECT * FROM gift_notes WHERE id = ?', [p.id])
  return parse.rowToGiftNote(rows[0]!)
}

export async function markGiftGiven(db: DbAdapter, id: string): Promise<GiftNote> {
  await db.exec('UPDATE gift_notes SET is_given = 1, given_at = ? WHERE id = ?', [now(), id])
  const rows = await db.queryAll('SELECT * FROM gift_notes WHERE id = ?', [id])
  return parse.rowToGiftNote(rows[0]!)
}

export async function deleteGiftNote(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM gift_notes WHERE id = ?', [id])
}

// ─── JOURNAL ─────────────────────────────────────────────────────────────────

export async function getJournalEntries(db: DbAdapter, vault_id: string): Promise<JournalEntry[]> {
  const rows = await db.queryAll(
    'SELECT * FROM journal_entries WHERE vault_id = ? ORDER BY date DESC',
    [vault_id],
  )
  return rows.map(parse.rowToJournalEntry)
}

export async function getJournalEntry(
  db: DbAdapter,
  date: string,
  vault_id: string,
): Promise<JournalEntry | null> {
  const rows = await db.queryAll('SELECT * FROM journal_entries WHERE vault_id = ? AND date = ?', [
    vault_id,
    date,
  ])
  return rows.length > 0 ? parse.rowToJournalEntry(rows[0]!) : null
}

export async function upsertJournalEntry(
  db: DbAdapter,
  p: Omit<JournalEntry, 'id' | 'created_at' | 'updated_at'>,
): Promise<JournalEntry> {
  const ts = now()
  const existing = await getJournalEntry(db, p.date, p.vault_id)
  if (existing) {
    await db.exec('UPDATE journal_entries SET title = ?, body = ?, updated_at = ? WHERE id = ?', [
      p.title,
      p.body,
      ts,
      existing.id,
    ])
    const rows = await db.queryAll('SELECT * FROM journal_entries WHERE id = ?', [existing.id])
    return parse.rowToJournalEntry(rows[0]!)
  }
  const id = uuid()
  await db.exec(
    `INSERT INTO journal_entries (id, vault_id, title, body, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, p.vault_id, p.title, p.body, p.date, ts, ts],
  )
  const rows = await db.queryAll('SELECT * FROM journal_entries WHERE id = ?', [id])
  return parse.rowToJournalEntry(rows[0]!)
}

export async function deleteJournalEntry(db: DbAdapter, id: string): Promise<void> {
  await db.exec('DELETE FROM journal_entries WHERE id = ?', [id])
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────

export async function search(
  db: DbAdapter,
  vault_id: string,
  query: string,
): Promise<SearchResult> {
  if (!query.trim()) return { contacts: [], notes: [] }

  const q = `${query.trim()}*`

  const contactRows = await db.queryAll(
    `SELECT c.* FROM contacts_fts fts
     JOIN contacts c ON c.id = fts.id
     WHERE c.vault_id = ? AND c.archived_at IS NULL AND contacts_fts MATCH ?
     ORDER BY rank LIMIT 20`,
    [vault_id, q],
  )
  const contacts = contactRows.map(parse.rowToContact)

  const noteRows = await db.queryAll(
    `SELECT n.*, c.id as c_id, c.first_name, c.last_name, c.nickname,
            c.vault_id as c_vault_id, c.avatar_url,
            c.is_starred, c.birthday, c.last_contacted_at,
            c.tags as c_tags, c.annotations as c_annotations,
            c.created_at as c_created_at, c.updated_at as c_updated_at,
            c.archived_at as c_archived_at, c.is_deceased,
            c.deceased_at, c.maiden_name, c.middle_name, c.pronouns,
            c.gender, c.how_we_met
     FROM notes_fts fts
     JOIN notes n ON n.id = fts.id
     JOIN contacts c ON c.id = n.contact_id
     WHERE c.vault_id = ? AND notes_fts MATCH ?
     ORDER BY rank LIMIT 20`,
    [vault_id, q],
  )

  const notes = noteRows.map((r) => ({
    ...parse.rowToNote(r),
    contact: parse.rowToContact({
      id: r['c_id'] as string,
      vault_id: r['c_vault_id'] as string,
      first_name: r['first_name'] as string,
      last_name: r['last_name'] as string,
      nickname: r['nickname'] as string,
      maiden_name: r['maiden_name'] as string,
      middle_name: r['middle_name'] as string,
      pronouns: r['pronouns'] as string,
      gender: r['gender'] as string,
      how_we_met: r['how_we_met'] as string,
      is_deceased: r['is_deceased'] as number,
      deceased_at: r['deceased_at'] as string | null,
      birthday: r['birthday'] as string | null,
      is_starred: r['is_starred'] as number,
      last_contacted_at: r['last_contacted_at'] as string | null,
      avatar_url: r['avatar_url'] as string | null,
      tags: r['c_tags'] as string,
      annotations: r['c_annotations'] as string,
      created_at: r['c_created_at'] as string,
      updated_at: r['c_updated_at'] as string,
      archived_at: r['c_archived_at'] as string | null,
    }),
  }))

  return { contacts, notes }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export async function getDashboard(db: DbAdapter, vault_id: string): Promise<DashboardData> {
  const upcoming_dates = await getUpcomingReminders(db, vault_id, 30)
  const overdue_stay_in_touch = await getOverdueStayInTouch(db, vault_id)
  const recent_interactions = await getInteractions(db, vault_id, undefined, 10)

  const todayStr = new Date().toISOString().slice(0, 10)
  const allContacts = await getContacts(db, vault_id)
  const upcoming_birthdays: DashboardData['upcoming_birthdays'] = []
  for (const contact of allContacts) {
    if (!contact.birthday) continue
    const [birthYearStr, month, day] = contact.birthday.split('-') as [string, string, string]
    const birthYear = Number(birthYearStr)
    const todayYear = Number(todayStr.slice(0, 4))
    let nextBirthday = `${todayYear}-${month}-${day}`
    if (nextBirthday < todayStr) nextBirthday = `${todayYear + 1}-${month}-${day}`
    const days_away = Math.round(
      (new Date(nextBirthday).getTime() - new Date(todayStr).getTime()) / 86400000,
    )
    if (days_away <= 30) {
      const nextYear = Number(nextBirthday.slice(0, 4))
      upcoming_birthdays.push({
        contact,
        days_away,
        turning_age: birthYear > 1800 ? nextYear - birthYear : null,
      })
    }
  }
  upcoming_birthdays.sort((a, b) => a.days_away - b.days_away)

  return { upcoming_dates, upcoming_birthdays, overdue_stay_in_touch, recent_interactions }
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

export async function exportVault(db: DbAdapter, vault_id: string): Promise<HalcyonExport> {
  const vaultRows = await db.queryAll('SELECT * FROM vaults WHERE id = ?', [vault_id])
  const vault = parse.rowToVault(vaultRows[0]!)

  const [
    contactRows,
    contactFieldRows,
    contactFieldTypeRows,
    addressRows,
    addressTypeRows,
    relationshipRows,
    relationshipTypeRows,
    companyRows,
    occupationRows,
    petRows,
    tagRows,
    groupRows,
    interactionRows,
    noteRows,
    lifeEventRows,
    lifeEventTypeRows,
    reminderRows,
    stayInTouchRows,
    taskRows,
    giftNoteRows,
    journalRows,
  ] = await Promise.all([
    db.queryAll('SELECT * FROM contacts WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT cf.* FROM contact_fields cf JOIN contacts c ON c.id = cf.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM contact_field_types WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT a.* FROM addresses a JOIN contacts c ON c.id = a.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM address_types WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT r.* FROM relationships r JOIN contacts c ON c.id = r.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM relationship_types WHERE vault_id = ?', [vault_id]),
    db.queryAll('SELECT * FROM companies WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT o.* FROM occupations o JOIN contacts c ON c.id = o.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll(
      'SELECT p.* FROM pets p JOIN contacts c ON c.id = p.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM tags WHERE vault_id = ?', [vault_id]),
    db.queryAll('SELECT * FROM groups WHERE vault_id = ?', [vault_id]),
    db.queryAll('SELECT * FROM interactions WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT n.* FROM notes n JOIN contacts c ON c.id = n.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll(
      'SELECT le.* FROM life_events le JOIN contacts c ON c.id = le.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM life_event_types WHERE vault_id = ?', [vault_id]),
    db.queryAll(
      'SELECT r.* FROM reminders r JOIN contacts c ON c.id = r.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll(
      'SELECT s.* FROM stay_in_touch s JOIN contacts c ON c.id = s.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll(
      'SELECT t.* FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll(
      'SELECT g.* FROM gift_notes g JOIN contacts c ON c.id = g.contact_id WHERE c.vault_id = ?',
      [vault_id],
    ),
    db.queryAll('SELECT * FROM journal_entries WHERE vault_id = ?', [vault_id]),
  ])

  return {
    version: 1,
    exported_at: now(),
    vault,
    contacts: contactRows.map(parse.rowToContact),
    contact_fields: contactFieldRows.map(parse.rowToContactField),
    contact_field_types: contactFieldTypeRows.map(parse.rowToContactFieldType),
    addresses: addressRows.map(parse.rowToAddress),
    address_types: addressTypeRows.map(parse.rowToAddressType),
    relationships: relationshipRows.map(parse.rowToRelationship),
    relationship_types: relationshipTypeRows.map(parse.rowToRelationshipType),
    companies: companyRows.map(parse.rowToCompany),
    occupations: occupationRows.map(parse.rowToOccupation),
    pets: petRows.map(parse.rowToPet),
    tags: tagRows.map(parse.rowToTag),
    groups: groupRows.map(parse.rowToGroup),
    interactions: interactionRows.map(parse.rowToInteraction),
    notes: noteRows.map(parse.rowToNote),
    life_events: lifeEventRows.map(parse.rowToLifeEvent),
    life_event_types: lifeEventTypeRows.map(parse.rowToLifeEventType),
    reminders: reminderRows.map(parse.rowToReminder),
    stay_in_touch: stayInTouchRows.map(parse.rowToStayInTouch),
    tasks: taskRows.map(parse.rowToTask),
    gift_notes: giftNoteRows.map(parse.rowToGiftNote),
    journal_entries: journalRows.map(parse.rowToJournalEntry),
  }
}

// ─── Seed helpers (used by createVault) ──────────────────────────────────────

async function seedDefaultFieldTypes(db: DbAdapter, vaultId: string): Promise<void> {
  const types = [
    { name: 'Phone', icon: 'i-heroicons-phone', protocol: 'tel:' },
    { name: 'Email', icon: 'i-heroicons-envelope', protocol: 'mailto:' },
    { name: 'Website', icon: 'i-heroicons-globe-alt', protocol: '' },
    { name: 'WhatsApp', icon: 'i-heroicons-chat-bubble-oval-left', protocol: 'https://wa.me/' },
    { name: 'Twitter', icon: 'i-heroicons-at-symbol', protocol: 'https://twitter.com/' },
    { name: 'LinkedIn', icon: 'i-heroicons-briefcase', protocol: 'https://linkedin.com/in/' },
    { name: 'Instagram', icon: 'i-heroicons-camera', protocol: 'https://instagram.com/' },
  ]
  for (const t of types) {
    await db.exec(
      `INSERT INTO contact_field_types (id, vault_id, name, icon, protocol, is_default)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [uuid(), vaultId, t.name, t.icon, t.protocol],
    )
  }
}

async function seedDefaultRelationshipTypes(db: DbAdapter, vaultId: string): Promise<void> {
  const types = [
    { name: 'partner of', name_reverse: 'partner of', symmetric: 1 },
    { name: 'parent of', name_reverse: 'child of', symmetric: 0 },
    { name: 'child of', name_reverse: 'parent of', symmetric: 0 },
    { name: 'sibling of', name_reverse: 'sibling of', symmetric: 1 },
    { name: 'friend of', name_reverse: 'friend of', symmetric: 1 },
    { name: 'colleague of', name_reverse: 'colleague of', symmetric: 1 },
    { name: 'mentor of', name_reverse: 'mentee of', symmetric: 0 },
    { name: 'mentee of', name_reverse: 'mentor of', symmetric: 0 },
  ]
  for (const t of types) {
    await db.exec(
      `INSERT INTO relationship_types (id, vault_id, name, name_reverse, is_symmetric, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), vaultId, t.name, t.name_reverse, t.symmetric, now()],
    )
  }
}

async function seedDefaultAddressTypes(db: DbAdapter, vaultId: string): Promise<void> {
  for (const name of ['Home', 'Work', 'Other']) {
    await db.exec('INSERT INTO address_types (id, vault_id, name) VALUES (?, ?, ?)', [
      uuid(),
      vaultId,
      name,
    ])
  }
}

async function seedDefaultLifeEventTypes(db: DbAdapter, vaultId: string): Promise<void> {
  const types = [
    { name: 'Got married', icon: 'i-heroicons-heart', category: 'family' },
    { name: 'Had a child', icon: 'i-heroicons-face-smile', category: 'family' },
    { name: 'Got engaged', icon: 'i-heroicons-sparkles', category: 'family' },
    { name: 'Got divorced', icon: 'i-heroicons-x-circle', category: 'family' },
    { name: 'Moved city', icon: 'i-heroicons-home', category: 'life' },
    { name: 'Started new job', icon: 'i-heroicons-briefcase', category: 'career' },
    { name: 'Changed career', icon: 'i-heroicons-arrow-path', category: 'career' },
    { name: 'Graduated', icon: 'i-heroicons-academic-cap', category: 'career' },
    { name: 'Lost a loved one', icon: 'i-heroicons-heart-broken', category: 'life' },
    { name: 'Medical event', icon: 'i-heroicons-beaker', category: 'health' },
  ]
  for (const t of types) {
    await db.exec(
      'INSERT INTO life_event_types (id, vault_id, name, icon, category) VALUES (?, ?, ?, ?, ?)',
      [uuid(), vaultId, t.name, t.icon, t.category],
    )
  }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export async function dispatch(db: DbAdapter, req: WorkerRequestBody): Promise<unknown> {
  switch (req.type) {
    // Vaults
    case 'GET_VAULTS':
      return getVaults(db)
    case 'CREATE_VAULT':
      return createVault(db, req.payload)
    case 'UPDATE_VAULT':
      return updateVault(db, req.payload)
    case 'DELETE_VAULT':
      await deleteVault(db, req.payload.id)
      return null

    // Contacts
    case 'GET_CONTACTS':
      return getContacts(db, req.payload.vault_id)
    case 'GET_CONTACT':
      return getContact(db, req.payload.id)
    case 'GET_CONTACT_DETAIL':
      return getContactDetail(db, req.payload.id)
    case 'CREATE_CONTACT':
      return createContact(db, req.payload)
    case 'UPDATE_CONTACT':
      return updateContact(db, req.payload)
    case 'ARCHIVE_CONTACT':
      await archiveContact(db, req.payload.id)
      return null
    case 'UNARCHIVE_CONTACT':
      await unarchiveContact(db, req.payload.id)
      return null
    case 'TOGGLE_STAR_CONTACT':
      return toggleStarContact(db, req.payload.id)

    // Contact field types
    case 'GET_CONTACT_FIELD_TYPES':
      return getContactFieldTypes(db, req.payload.vault_id)
    case 'CREATE_CONTACT_FIELD_TYPE':
      return createContactFieldType(db, req.payload)
    case 'UPDATE_CONTACT_FIELD_TYPE':
      return updateContactFieldType(db, req.payload)
    case 'DELETE_CONTACT_FIELD_TYPE':
      await deleteContactFieldType(db, req.payload.id)
      return null

    // Contact fields
    case 'CREATE_CONTACT_FIELD':
      return createContactField(db, req.payload)
    case 'UPDATE_CONTACT_FIELD':
      return updateContactField(db, req.payload)
    case 'DELETE_CONTACT_FIELD':
      await deleteContactField(db, req.payload.id)
      return null

    // Addresses
    case 'GET_ADDRESS_TYPES':
      return getAddressTypes(db, req.payload.vault_id)
    case 'CREATE_ADDRESS_TYPE':
      await createAddressType(db, req.payload)
      return null
    case 'CREATE_ADDRESS':
      return createAddress(db, req.payload)
    case 'UPDATE_ADDRESS':
      return updateAddress(db, req.payload)
    case 'DELETE_ADDRESS':
      await deleteAddress(db, req.payload.id)
      return null

    // Relationship types
    case 'GET_RELATIONSHIP_TYPES':
      return getRelationshipTypes(db, req.payload.vault_id)
    case 'CREATE_RELATIONSHIP_TYPE':
      return createRelationshipType(db, req.payload)
    case 'UPDATE_RELATIONSHIP_TYPE':
      return updateRelationshipType(db, req.payload)
    case 'DELETE_RELATIONSHIP_TYPE':
      await deleteRelationshipType(db, req.payload.id)
      return null
    case 'CREATE_RELATIONSHIP':
      return createRelationship(db, req.payload)
    case 'DELETE_RELATIONSHIP':
      await deleteRelationship(db, req.payload.id)
      return null

    // Companies
    case 'GET_COMPANIES':
      return getCompanies(db, req.payload.vault_id)
    case 'GET_COMPANY':
      return getCompany(db, req.payload.id)
    case 'GET_COMPANY_CONTACTS':
      return getCompanyContacts(db, req.payload.company_id)
    case 'CREATE_COMPANY':
      return createCompany(db, req.payload)
    case 'UPDATE_COMPANY':
      return updateCompany(db, req.payload)
    case 'DELETE_COMPANY':
      await deleteCompany(db, req.payload.id)
      return null

    // Occupations
    case 'GET_OCCUPATIONS':
      return getOccupations(db, req.payload.contact_id)
    case 'CREATE_OCCUPATION':
      return createOccupation(db, req.payload)
    case 'UPDATE_OCCUPATION':
      return updateOccupation(db, req.payload)
    case 'DELETE_OCCUPATION':
      await deleteOccupation(db, req.payload.id)
      return null

    // Pets
    case 'GET_PETS':
      return getPets(db, req.payload.contact_id)
    case 'CREATE_PET':
      return createPet(db, req.payload)
    case 'UPDATE_PET':
      return updatePet(db, req.payload)
    case 'DELETE_PET':
      await deletePet(db, req.payload.id)
      return null

    // Tags
    case 'GET_TAGS':
      return getTags(db, req.payload.vault_id)
    case 'CREATE_TAG':
      return createTag(db, req.payload)
    case 'UPDATE_TAG':
      return updateTag(db, req.payload)
    case 'DELETE_TAG':
      await deleteTag(db, req.payload.id)
      return null
    case 'SET_CONTACT_TAGS':
      await setContactTags(db, req.payload.contact_id, req.payload.tag_ids)
      return null

    // Groups
    case 'GET_GROUPS':
      return getGroups(db, req.payload.vault_id)
    case 'GET_GROUP':
      return getGroup(db, req.payload.id)
    case 'CREATE_GROUP':
      return createGroup(db, req.payload)
    case 'UPDATE_GROUP':
      return updateGroup(db, req.payload)
    case 'DELETE_GROUP':
      await deleteGroup(db, req.payload.id)
      return null
    case 'ADD_TO_GROUP':
      await addToGroup(db, req.payload.group_id, req.payload.contact_id)
      return null
    case 'REMOVE_FROM_GROUP':
      await removeFromGroup(db, req.payload.group_id, req.payload.contact_id)
      return null
    case 'GET_GROUP_CONTACTS':
      return getGroupContacts(db, req.payload.group_id)

    // Interactions
    case 'GET_INTERACTIONS':
      return getInteractions(db, req.payload.vault_id, req.payload.contact_id, req.payload.limit)
    case 'GET_INTERACTION':
      return getInteraction(db, req.payload.id)
    case 'CREATE_INTERACTION':
      return createInteraction(db, req.payload)
    case 'UPDATE_INTERACTION':
      return updateInteraction(db, req.payload)
    case 'DELETE_INTERACTION':
      await deleteInteraction(db, req.payload.id)
      return null

    // Notes
    case 'GET_NOTES':
      return getNotes(db, req.payload.contact_id)
    case 'CREATE_NOTE':
      return createNote(db, req.payload)
    case 'UPDATE_NOTE':
      return updateNote(db, req.payload)
    case 'DELETE_NOTE':
      await deleteNote(db, req.payload.id)
      return null
    case 'TOGGLE_PIN_NOTE':
      return togglePinNote(db, req.payload.id)

    // Life event types
    case 'GET_LIFE_EVENT_TYPES':
      return getLifeEventTypes(db, req.payload.vault_id)
    case 'CREATE_LIFE_EVENT_TYPE':
      return createLifeEventType(db, req.payload)

    // Life events
    case 'GET_LIFE_EVENTS':
      return getLifeEvents(db, req.payload.contact_id)
    case 'CREATE_LIFE_EVENT':
      return createLifeEvent(db, req.payload)
    case 'UPDATE_LIFE_EVENT':
      return updateLifeEvent(db, req.payload)
    case 'DELETE_LIFE_EVENT':
      await deleteLifeEvent(db, req.payload.id)
      return null

    // Reminders
    case 'GET_REMINDERS':
      return getReminders(db, req.payload.contact_id)
    case 'GET_UPCOMING_REMINDERS':
      return getUpcomingReminders(db, req.payload.vault_id, req.payload.days)
    case 'CREATE_REMINDER':
      return createReminder(db, req.payload)
    case 'UPDATE_REMINDER':
      return updateReminder(db, req.payload)
    case 'DONE_REMINDER':
      return doneReminder(db, req.payload.id)
    case 'DELETE_REMINDER':
      await deleteReminder(db, req.payload.id)
      return null

    // Stay-in-touch
    case 'GET_STAY_IN_TOUCH':
      return getStayInTouch(db, req.payload.contact_id)
    case 'GET_OVERDUE_STAY_IN_TOUCH':
      return getOverdueStayInTouch(db, req.payload.vault_id)
    case 'SET_STAY_IN_TOUCH':
      return setStayInTouch(db, req.payload.contact_id, req.payload.frequency_days)
    case 'REMOVE_STAY_IN_TOUCH':
      await removeStayInTouch(db, req.payload.contact_id)
      return null
    case 'MARK_CONTACTED':
      await markContacted(db, req.payload.contact_id)
      return null

    // Tasks
    case 'GET_TASKS':
      return getTasks(db, req.payload.contact_id)
    case 'CREATE_TASK':
      return createTask(db, req.payload)
    case 'UPDATE_TASK':
      return updateTask(db, req.payload)
    case 'TOGGLE_TASK':
      return toggleTask(db, req.payload.id)
    case 'DELETE_TASK':
      await deleteTask(db, req.payload.id)
      return null

    // Gift notes
    case 'GET_GIFT_NOTES':
      return getGiftNotes(db, req.payload.contact_id)
    case 'CREATE_GIFT_NOTE':
      return createGiftNote(db, req.payload)
    case 'UPDATE_GIFT_NOTE':
      return updateGiftNote(db, req.payload)
    case 'MARK_GIFT_GIVEN':
      return markGiftGiven(db, req.payload.id)
    case 'DELETE_GIFT_NOTE':
      await deleteGiftNote(db, req.payload.id)
      return null

    // Journal
    case 'GET_JOURNAL_ENTRIES':
      return getJournalEntries(db, req.payload.vault_id)
    case 'GET_JOURNAL_ENTRY':
      return getJournalEntry(db, req.payload.date, req.payload.vault_id)
    case 'UPSERT_JOURNAL_ENTRY':
      return upsertJournalEntry(db, req.payload)
    case 'DELETE_JOURNAL_ENTRY':
      await deleteJournalEntry(db, req.payload.id)
      return null

    // Search
    case 'SEARCH':
      return search(db, req.payload.vault_id, req.payload.query)

    // Dashboard
    case 'GET_DASHBOARD':
      return getDashboard(db, req.payload.vault_id)

    // EXPORT_VAULT is handled by the worker directly (not dispatched here)
    case 'EXPORT_VAULT':
      return exportVault(db, req.payload.vault_id)

    // NUKE_OPFS is handled by the worker/native layer directly
    case 'NUKE_OPFS':
      return null

    default:
      req satisfies never
      throw new Error('Unknown request type')
  }
}
