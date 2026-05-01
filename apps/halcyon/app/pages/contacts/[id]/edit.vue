<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import type {
  Address, AddressType, Company, ContactDetail, ContactField, ContactFieldType,
  GiftNote, LifeEvent, LifeEventType, Occupation, Pet, Relationship, RelationshipType, Reminder, StayInTouch, Task,
} from '~/types/database'
import { formatDate, localDateString } from '~/utils/format'

const route = useRoute()
const router = useRouter()
const db = useDatabase()
const toast = useToast()

const contact = ref<ContactDetail | null>(null)
const loading = ref(true)
const saving = ref(false)

// Form state
const form = reactive({
  first_name: '',
  last_name: '',
  nickname: '',
  maiden_name: '',
  middle_name: '',
  pronouns: '',
  gender: '',
  how_we_met: '',
  is_deceased: false,
  deceased_at: '',
  birthday: '',
  is_starred: false,
})

// Related data
const fieldTypes = ref<ContactFieldType[]>([])
const addressTypes = ref<AddressType[]>([])
const fields = ref<ContactField[]>([])
const addresses = ref<Address[]>([])
const pets = ref<Pet[]>([])
const reminders = ref<Reminder[]>([])
const tasks = ref<Task[]>([])
const stayInTouch = ref<StayInTouch | null>(null)

// Field add form
const newField = reactive({ type_id: '', value: '', label: '' })
const addingField = ref(false)

// Address add form
const newAddress = reactive({ type_id: '', street: '', city: '', province: '', postal_code: '', country: '' })
const addingAddress = ref(false)

// Pet form
const newPet = reactive({ name: '', species: '', breed: '', notes: '' })
const addingPet = ref(false)

// Reminder form
const newReminder = reactive({ title: '', remind_at: '', is_yearly: false })
const addingReminder = ref(false)

// Task form
const newTask = reactive({ title: '', due_at: '', notes: '' })
const addingTask = ref(false)

// Gift note form
const giftNotes = ref<GiftNote[]>([])
const newGift = reactive({ idea: '', occasion: '' })
const addingGift = ref(false)

// Life events (anniversaries, dates)
const lifeEvents = ref<LifeEvent[]>([])
const lifeEventTypes = ref<LifeEventType[]>([])
const newEvent = reactive({ label: '', happened_at: '', yearly_reminder: false, type_id: '' })
const addingEvent = ref(false)

// Relationships
const relationships = ref<Relationship[]>([])
const relTypes = ref<RelationshipType[]>([])
const newRel = reactive({ related_id: '', type_id: '', notes: '' })
const relSearch = ref('')
const relSearchResults = ref<Array<{ id: string; name: string }>>([])
const addingRel = ref(false)

// Occupations
const occupations = ref<Occupation[]>([])
const companies = ref<Company[]>([])
const newOcc = reactive({ company_id: '', title: '', department: '', started_at: '', is_current: true })
const addingOcc = ref(false)

// Stay-in-touch form
const sitFrequency = ref(30)
const editingSit = ref(false)

async function load() {
  const id = route.params['id'] as string
  loading.value = true
  try {
    const detail = await db.getContactDetail(id)
    const [fts, ats, rems, tks, gifts, rts, cos, les, lets] = await Promise.all([
      db.getContactFieldTypes(detail.vault_id),
      db.getAddressTypes(detail.vault_id),
      db.getReminders(id),
      db.getTasks(id),
      db.getGiftNotes(id),
      db.getRelationshipTypes(detail.vault_id),
      db.getCompanies(detail.vault_id),
      db.getLifeEvents(id),
      db.getLifeEventTypes(detail.vault_id),
    ])
    contact.value = detail
    fieldTypes.value = fts
    addressTypes.value = ats

    Object.assign(form, {
      first_name: detail.first_name,
      last_name: detail.last_name ?? '',
      nickname: detail.nickname ?? '',
      maiden_name: detail.maiden_name ?? '',
      middle_name: detail.middle_name ?? '',
      pronouns: detail.pronouns ?? '',
      gender: detail.gender ?? '',
      how_we_met: detail.how_we_met ?? '',
      is_deceased: detail.is_deceased,
      deceased_at: detail.deceased_at ?? '',
      birthday: detail.birthday ?? '',
      is_starred: detail.is_starred,
    })

    fields.value = detail.fields
    addresses.value = detail.addresses
    pets.value = detail.pets
    reminders.value = rems
    tasks.value = tks
    giftNotes.value = gifts
    relTypes.value = rts
    companies.value = cos
    lifeEvents.value = les
    lifeEventTypes.value = lets
    relationships.value = detail.relationships
    occupations.value = [...(detail.current_occupation ? [detail.current_occupation] : []), ...detail.past_occupations]
    stayInTouch.value = detail.stay_in_touch ?? null
    if (stayInTouch.value) sitFrequency.value = stayInTouch.value.frequency_days
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save() {
  if (!contact.value) return
  saving.value = true
  try {
    await db.updateContact({
      id: contact.value.id,
      ...form,
      deceased_at: form.deceased_at || null,
      birthday: form.birthday || null,
    })
    toast.add({ title: 'Contact saved', color: 'success' })
    router.push(`/contacts/${contact.value.id}`)
  } finally {
    saving.value = false
  }
}

async function addField() {
  if (!contact.value || !newField.type_id || !newField.value) return
  addingField.value = true
  try {
    const f = await db.createContactField({
      contact_id: contact.value.id,
      type_id: newField.type_id,
      value: newField.value,
      label: newField.label,
    })
    fields.value.push(f)
    Object.assign(newField, { type_id: '', value: '', label: '' })
    toast.add({ title: 'Field added', color: 'success' })
  } finally {
    addingField.value = false
  }
}

async function removeField(id: string) {
  await db.deleteContactField(id)
  fields.value = fields.value.filter((f) => f.id !== id)
  toast.add({ title: 'Field removed', color: 'success' })
}

async function addAddress() {
  if (!contact.value) return
  addingAddress.value = true
  try {
    const a = await db.createAddress({
      contact_id: contact.value.id,
      type_id: newAddress.type_id || null,
      street: newAddress.street,
      city: newAddress.city,
      province: newAddress.province,
      postal_code: newAddress.postal_code,
      country: newAddress.country,
      is_primary: addresses.value.length === 0,
    })
    addresses.value.push(a)
    Object.assign(newAddress, { type_id: '', street: '', city: '', province: '', postal_code: '', country: '' })
    toast.add({ title: 'Address added', color: 'success' })
  } finally {
    addingAddress.value = false
  }
}

async function removeAddress(id: string) {
  await db.deleteAddress(id)
  addresses.value = addresses.value.filter((a) => a.id !== id)
  toast.add({ title: 'Address removed', color: 'success' })
}

async function addPet() {
  if (!contact.value || !newPet.name) return
  addingPet.value = true
  try {
    const p = await db.createPet({
      contact_id: contact.value.id,
      name: newPet.name,
      species: newPet.species,
      breed: newPet.breed,
      notes: newPet.notes,
    })
    pets.value.push(p)
    Object.assign(newPet, { name: '', species: '', breed: '', notes: '' })
    toast.add({ title: 'Pet added', color: 'success' })
  } finally {
    addingPet.value = false
  }
}

async function removePet(id: string) {
  await db.deletePet(id)
  pets.value = pets.value.filter((p) => p.id !== id)
  toast.add({ title: 'Pet removed', color: 'success' })
}

async function addReminder() {
  if (!contact.value || !newReminder.title || !newReminder.remind_at) return
  addingReminder.value = true
  try {
    const r = await db.createReminder({
      contact_id: contact.value.id,
      title: newReminder.title,
      body: '',
      remind_at: newReminder.remind_at,
      is_yearly: newReminder.is_yearly,
    })
    reminders.value.push(r)
    Object.assign(newReminder, { title: '', remind_at: '', is_yearly: false })
    toast.add({ title: 'Reminder added', color: 'success' })
  } finally {
    addingReminder.value = false
  }
}

async function removeReminder(id: string) {
  await db.deleteReminder(id)
  reminders.value = reminders.value.filter((r) => r.id !== id)
  toast.add({ title: 'Reminder removed', color: 'success' })
}

async function addTask() {
  if (!contact.value || !newTask.title) return
  addingTask.value = true
  try {
    const t = await db.createTask({
      contact_id: contact.value.id,
      title: newTask.title,
      due_at: newTask.due_at || null,
      notes: newTask.notes,
    })
    tasks.value.push(t)
    Object.assign(newTask, { title: '', due_at: '', notes: '' })
    toast.add({ title: 'Task added', color: 'success' })
  } finally {
    addingTask.value = false
  }
}

async function toggleTask(t: Task) {
  const updated = await db.toggleTask(t.id)
  const idx = tasks.value.findIndex((x) => x.id === t.id)
  if (idx !== -1) tasks.value[idx] = updated
}

async function removeTask(id: string) {
  await db.deleteTask(id)
  tasks.value = tasks.value.filter((t) => t.id !== id)
  toast.add({ title: 'Task removed', color: 'success' })
}

async function saveSit() {
  if (!contact.value) return
  const s = await db.setStayInTouch(contact.value.id, sitFrequency.value)
  stayInTouch.value = s
  editingSit.value = false
  toast.add({ title: 'Stay-in-touch saved', color: 'success' })
}

async function removeSit() {
  if (!contact.value) return
  await db.removeStayInTouch(contact.value.id)
  stayInTouch.value = null
  editingSit.value = false
  toast.add({ title: 'Stay-in-touch removed', color: 'success' })
}

async function addGiftNote() {
  if (!contact.value || !newGift.idea.trim()) return
  addingGift.value = true
  try {
    const g = await db.createGiftNote({ contact_id: contact.value.id, idea: newGift.idea.trim(), occasion: newGift.occasion })
    giftNotes.value.push(g)
    Object.assign(newGift, { idea: '', occasion: '' })
    toast.add({ title: 'Gift idea added', color: 'success' })
  } finally {
    addingGift.value = false
  }
}

async function removeGiftNote(id: string) {
  await db.deleteGiftNote(id)
  giftNotes.value = giftNotes.value.filter((g) => g.id !== id)
  toast.add({ title: 'Gift idea removed', color: 'success' })
}

async function addLifeEvent() {
  if (!contact.value || !newEvent.label.trim()) return
  addingEvent.value = true
  try {
    const le = await db.createLifeEvent({
      contact_id: contact.value.id,
      type_id: newEvent.type_id || null,
      label: newEvent.label.trim(),
      notes: '',
      happened_at: newEvent.happened_at || null,
      yearly_reminder: newEvent.yearly_reminder,
    })
    lifeEvents.value.push(le)
    Object.assign(newEvent, { label: '', happened_at: '', yearly_reminder: false, type_id: '' })
    toast.add({ title: 'Date added', color: 'success' })
  } finally {
    addingEvent.value = false
  }
}

async function removeLifeEvent(id: string) {
  await db.deleteLifeEvent(id)
  lifeEvents.value = lifeEvents.value.filter((le) => le.id !== id)
  toast.add({ title: 'Date removed', color: 'success' })
}

const relDebounce = useDebounceFn(async () => {
  if (!relSearch.value.trim() || !contact.value) return
  const results = await db.search(contact.value.vault_id, relSearch.value)
  relSearchResults.value = results.contacts
    .filter((c) => c.id !== contact.value!.id)
    .map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ') }))
}, 300)
watch(relSearch, relDebounce)

function selectRelContact(id: string, name: string) {
  newRel.related_id = id
  relSearch.value = name
  relSearchResults.value = []
}

async function addRelationship() {
  if (!contact.value || !newRel.related_id || !newRel.type_id) return
  addingRel.value = true
  try {
    const r = await db.createRelationship({ contact_id: contact.value.id, related_id: newRel.related_id, type_id: newRel.type_id, notes: newRel.notes })
    relationships.value.push(r)
    Object.assign(newRel, { related_id: '', type_id: '', notes: '' })
    relSearch.value = ''
    toast.add({ title: 'Relationship added', color: 'success' })
  } finally {
    addingRel.value = false
  }
}

async function removeRelationship(id: string) {
  await db.deleteRelationship(id)
  relationships.value = relationships.value.filter((r) => r.id !== id)
  toast.add({ title: 'Relationship removed', color: 'success' })
}

async function addOccupation() {
  if (!contact.value) return
  addingOcc.value = true
  try {
    const o = await db.createOccupation({
      contact_id: contact.value.id,
      company_id: newOcc.company_id || null,
      title: newOcc.title,
      department: newOcc.department,
      is_current: newOcc.is_current,
      started_at: newOcc.started_at || null,
      ended_at: null,
    })
    occupations.value.push(o)
    Object.assign(newOcc, { company_id: '', title: '', department: '', started_at: '', is_current: true })
    toast.add({ title: 'Position added', color: 'success' })
  } finally {
    addingOcc.value = false
  }
}

async function removeOccupation(id: string) {
  await db.deleteOccupation(id)
  occupations.value = occupations.value.filter((o) => o.id !== id)
  toast.add({ title: 'Position removed', color: 'success' })
}

const today = localDateString(new Date())
</script>

<template>
  <div v-if="loading" class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <USkeleton class="h-24 rounded-xl" />
    <USkeleton class="h-64 rounded-xl" />
  </div>

  <div v-else-if="!contact" class="max-w-2xl mx-auto px-4 py-16 text-center">
    <p class="text-zinc-500">Contact not found</p>
    <UButton to="/contacts" class="mt-4" variant="soft" color="violet">Back to contacts</UButton>
  </div>

  <div v-else class="max-w-2xl mx-auto pb-24">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" :to="`/contacts/${contact.id}`" />
      <h1 class="font-semibold text-zinc-100 flex-1">Edit contact</h1>
      <UButton color="violet" :loading="saving" @click="save">Save</UButton>
    </div>

    <div class="space-y-4 px-4">
      <!-- Basic info -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Basic info</p>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="First name">
            <UInput v-model="form.first_name" placeholder="First name" />
          </UFormField>
          <UFormField label="Last name">
            <UInput v-model="form.last_name" placeholder="Last name" />
          </UFormField>
        </div>
        <UFormField label="Nickname">
          <UInput v-model="form.nickname" placeholder="Nickname" />
        </UFormField>
        <UFormField label="Middle name">
          <UInput v-model="form.middle_name" placeholder="Middle name" />
        </UFormField>
        <UFormField label="Maiden name">
          <UInput v-model="form.maiden_name" placeholder="Maiden name" />
        </UFormField>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Pronouns">
            <UInput v-model="form.pronouns" placeholder="they/them" />
          </UFormField>
          <UFormField label="Gender">
            <UInput v-model="form.gender" placeholder="Gender" />
          </UFormField>
        </div>
        <UFormField label="Birthday">
          <UInput v-model="form.birthday" type="date" />
        </UFormField>
        <UFormField label="How we met">
          <UTextarea v-model="form.how_we_met" placeholder="How did you meet?" rows="2" />
        </UFormField>
        <div class="flex items-center gap-3">
          <UCheckbox v-model="form.is_deceased" label="Deceased" />
          <UInput
            v-if="form.is_deceased"
            v-model="form.deceased_at"
            type="date"
            placeholder="Date of death"
            class="flex-1"
          />
        </div>
      </div>

      <!-- Contact fields -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Contact info</p>
        <div v-for="field in fields" :key="field.id" class="flex items-center gap-2">
          <span class="text-zinc-400 text-sm flex-1">{{ field.value }}</span>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeField(field.id)" />
        </div>
        <div class="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <USelect v-model="newField.type_id" :options="fieldTypes.map(ft => ({ label: ft.name, value: ft.id }))" placeholder="Type" />
          <UInput v-model="newField.value" placeholder="Value" />
          <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingField" :disabled="!newField.type_id || !newField.value" @click="addField" />
        </div>
      </div>

      <!-- Addresses -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Addresses</p>
        <div v-for="addr in addresses" :key="addr.id" class="flex items-start gap-2">
          <div class="flex-1 text-sm text-zinc-300">
            <p v-if="addr.street">{{ addr.street }}</p>
            <p>{{ [addr.city, addr.province, addr.postal_code].filter(Boolean).join(', ') }}</p>
            <p v-if="addr.country" class="text-zinc-500">{{ addr.country }}</p>
          </div>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeAddress(addr.id)" />
        </div>
        <div class="space-y-2">
          <UInput v-model="newAddress.street" placeholder="Street" />
          <div class="grid grid-cols-2 gap-2">
            <UInput v-model="newAddress.city" placeholder="City" />
            <UInput v-model="newAddress.province" placeholder="State / Province" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <UInput v-model="newAddress.postal_code" placeholder="Postal code" />
            <UInput v-model="newAddress.country" placeholder="Country" />
          </div>
          <UButton size="sm" variant="soft" color="violet" icon="i-heroicons-plus" :loading="addingAddress" @click="addAddress">
            Add address
          </UButton>
        </div>
      </div>

      <!-- Pets -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pets</p>
        <div v-for="pet in pets" :key="pet.id" class="flex items-center gap-2">
          <span class="text-zinc-300 text-sm flex-1">
            {{ pet.name }}{{ pet.species ? ` (${pet.species})` : '' }}
          </span>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removePet(pet.id)" />
        </div>
        <div class="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
          <UInput v-model="newPet.name" placeholder="Name" />
          <UInput v-model="newPet.species" placeholder="Species" />
          <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingPet" :disabled="!newPet.name" @click="addPet" />
        </div>
      </div>

      <!-- Stay-in-touch -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stay in touch</p>
          <div class="flex gap-2">
            <UButton v-if="stayInTouch && !editingSit" size="xs" variant="ghost" icon="i-heroicons-pencil" @click="editingSit = true" />
            <UButton v-if="stayInTouch && !editingSit" size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeSit" />
          </div>
        </div>
        <div v-if="stayInTouch && !editingSit" class="text-sm text-zinc-300">
          Every {{ stayInTouch.frequency_days }} days
        </div>
        <div v-else class="flex gap-2 items-end">
          <UFormField label="Every N days" class="flex-1">
            <UInput v-model.number="sitFrequency" type="number" min="1" max="365" />
          </UFormField>
          <UButton color="violet" variant="soft" @click="saveSit">Save</UButton>
          <UButton v-if="editingSit" variant="ghost" color="neutral" @click="editingSit = false">Cancel</UButton>
        </div>
      </div>

      <!-- Dates & anniversaries (life events) -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Dates &amp; anniversaries</p>
        <div v-for="le in lifeEvents" :key="le.id" class="flex items-center gap-2">
          <UIcon name="i-heroicons-sparkles" class="size-4 text-amber-400 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm text-zinc-200 truncate">{{ le.label || 'Life event' }}</p>
            <p class="text-xs text-zinc-500">
              {{ le.happened_at ? formatDate(le.happened_at) : 'No date' }}{{ le.yearly_reminder ? ' · yearly' : '' }}
            </p>
          </div>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeLifeEvent(le.id)" />
        </div>
        <div class="space-y-2">
          <UInput v-model="newEvent.label" placeholder="e.g. Wedding anniversary" />
          <div class="flex gap-2 items-center">
            <UInput v-model="newEvent.happened_at" type="date" class="flex-1" />
            <label class="flex items-center gap-1.5 text-sm text-zinc-400">
              <UCheckbox v-model="newEvent.yearly_reminder" />
              Yearly
            </label>
            <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingEvent" :disabled="!newEvent.label.trim()" @click="addLifeEvent" />
          </div>
        </div>
      </div>

      <!-- Reminders -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Reminders</p>
        <div v-for="r in reminders" :key="r.id" class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm text-zinc-200 truncate">{{ r.title }}</p>
            <p class="text-xs text-zinc-500">
              {{ formatDate(r.remind_at) }}{{ r.is_yearly ? ' · yearly' : '' }}
            </p>
          </div>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeReminder(r.id)" />
        </div>
        <div class="space-y-2">
          <UInput v-model="newReminder.title" placeholder="Reminder title" />
          <div class="flex gap-2 items-center">
            <UInput v-model="newReminder.remind_at" type="date" class="flex-1" />
            <label class="flex items-center gap-1.5 text-sm text-zinc-400">
              <UCheckbox v-model="newReminder.is_yearly" />
              Yearly
            </label>
            <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingReminder" :disabled="!newReminder.title || !newReminder.remind_at" @click="addReminder" />
          </div>
        </div>
      </div>

      <!-- Tasks -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tasks</p>
        <div v-for="t in tasks" :key="t.id" class="flex items-center gap-2">
          <UCheckbox :model-value="t.is_done" @update:model-value="toggleTask(t)" />
          <span class="text-sm flex-1" :class="t.is_done ? 'line-through text-zinc-600' : 'text-zinc-200'">
            {{ t.title }}
          </span>
          <span v-if="t.due_at" class="text-xs text-zinc-500">{{ formatDate(t.due_at) }}</span>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeTask(t.id)" />
        </div>
        <div class="flex gap-2 items-end">
          <UInput v-model="newTask.title" placeholder="Task title" class="flex-1" />
          <UInput v-model="newTask.due_at" type="date" class="w-36" />
          <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingTask" :disabled="!newTask.title" @click="addTask" />
        </div>
      </div>

      <!-- Gift notes -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Gift ideas</p>
        <div v-for="g in giftNotes" :key="g.id" class="flex items-center gap-2">
          <UIcon :name="g.is_given ? 'i-heroicons-gift' : 'i-heroicons-gift'" class="size-4 shrink-0" :class="g.is_given ? 'text-zinc-600' : 'text-violet-400'" />
          <span class="text-sm flex-1" :class="g.is_given ? 'line-through text-zinc-600' : 'text-zinc-200'">
            {{ g.idea }}<span v-if="g.occasion" class="text-zinc-500"> · {{ g.occasion }}</span>
          </span>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeGiftNote(g.id)" />
        </div>
        <div class="space-y-2">
          <div class="flex gap-2">
            <UInput v-model="newGift.idea" placeholder="Gift idea" class="flex-1" />
            <UInput v-model="newGift.occasion" placeholder="Occasion (opt.)" class="w-36" />
            <UButton icon="i-heroicons-plus" color="violet" variant="soft" :loading="addingGift" :disabled="!newGift.idea" @click="addGiftNote" />
          </div>
        </div>
      </div>

      <!-- Relationships -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Relationships</p>
        <div v-for="rel in relationships" :key="rel.id" class="flex items-center gap-2">
          <div class="flex-1 text-sm text-zinc-300 min-w-0">
            <span>{{ relTypes.find(t => t.id === rel.type_id)?.name ?? 'Related' }}</span>
            <span v-if="rel.notes" class="text-zinc-500 ml-1">· {{ rel.notes }}</span>
          </div>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeRelationship(rel.id)" />
        </div>
        <div class="space-y-2">
          <div class="relative">
            <UInput v-model="relSearch" placeholder="Search contact…" icon="i-heroicons-magnifying-glass" />
            <div v-if="relSearchResults.length > 0" class="absolute top-full left-0 right-0 z-10 bg-zinc-800 rounded-xl mt-1 divide-y divide-zinc-700 shadow-xl">
              <button
                v-for="r in relSearchResults"
                :key="r.id"
                class="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 first:rounded-t-xl last:rounded-b-xl"
                @click="selectRelContact(r.id, r.name)"
              >
                {{ r.name }}
              </button>
            </div>
          </div>
          <div class="flex gap-2">
            <USelect
              v-model="newRel.type_id"
              :options="relTypes.map(t => ({ label: t.name, value: t.id }))"
              placeholder="Relationship type"
              class="flex-1"
            />
            <UButton
              icon="i-heroicons-plus"
              color="violet"
              variant="soft"
              :loading="addingRel"
              :disabled="!newRel.related_id || !newRel.type_id"
              @click="addRelationship"
            />
          </div>
        </div>
      </div>

      <!-- Occupations -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Work history</p>
        <div v-for="occ in occupations" :key="occ.id" class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm text-zinc-200">{{ occ.title || 'Employee' }}</p>
            <p class="text-xs text-zinc-500">
              {{ occ.is_current ? 'Current' : '' }}
              {{ occ.started_at ? `· From ${occ.started_at.slice(0, 4)}` : '' }}
            </p>
          </div>
          <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="removeOccupation(occ.id)" />
        </div>
        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <UInput v-model="newOcc.title" placeholder="Job title" />
            <USelect
              v-model="newOcc.company_id"
              :options="[{ label: 'No company', value: '' }, ...companies.map(c => ({ label: c.name, value: c.id }))]"
            />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <UInput v-model="newOcc.department" placeholder="Department (opt.)" />
            <UInput v-model="newOcc.started_at" type="date" placeholder="Start date" />
          </div>
          <div class="flex items-center justify-between">
            <UCheckbox v-model="newOcc.is_current" label="Current position" />
            <UButton size="sm" variant="soft" color="violet" :loading="addingOcc" @click="addOccupation">
              Add position
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
