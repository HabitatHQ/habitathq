<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import type { ContactDetail, GiftNote, InteractionWithContacts, LifeEvent, Note, Reminder, Task } from '~/types/database'
import { contactDisplayName, contactInitials } from '~/utils/contact-helpers'
import { formatDate, formatDateRelative, formatRelativeTime, localDateString } from '~/utils/format'
import { getRelationshipLabel } from '~/utils/relationship-helpers'
import { interactionIcon, interactionSummary } from '~/utils/interaction-helpers'
import { addressOneLiner } from '~/utils/address-helpers'
import { daysUntilBirthday, turningAge } from '~/utils/dashboard-helpers'

const route = useRoute()
const db = useDatabase()
const toast = useToast()

const today = localDateString(new Date())
const contact = ref<ContactDetail | null>(null)
const interactions = ref<InteractionWithContacts[]>([])
const notes = ref<Note[]>([])
const lifeEvents = ref<LifeEvent[]>([])
const reminders = ref<Reminder[]>([])
const tasks = ref<Task[]>([])
const giftNotes = ref<GiftNote[]>([])
const loading = ref(true)

// New note form
const newNote = ref('')
const savingNote = ref(false)

async function loadAll() {
  const id = route.params['id'] as string
  loading.value = true
  try {
    const detail = await db.getContactDetail(id)
    contact.value = detail
    const [ixns, ns, les, rems, tks, gifts] = await Promise.all([
      db.getInteractions(detail.vault_id, id),
      db.getNotes(id),
      db.getLifeEvents(id),
      db.getReminders(id),
      db.getTasks(id),
      db.getGiftNotes(id),
    ])
    interactions.value = ixns
    notes.value = ns
    lifeEvents.value = les
    reminders.value = rems
    tasks.value = tks
    giftNotes.value = gifts
  } catch {
    contact.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

async function addNote() {
  if (!newNote.value.trim() || !contact.value) return
  savingNote.value = true
  try {
    const note = await db.createNote({
      contact_id: contact.value.id,
      body: newNote.value.trim(),
      is_pinned: false,
    })
    notes.value.unshift(note)
    newNote.value = ''
    toast.add({ title: 'Note added', color: 'success' })
  } finally {
    savingNote.value = false
  }
}

async function togglePin(note: Note) {
  const updated = await db.togglePinNote(note.id)
  const idx = notes.value.findIndex((n) => n.id === note.id)
  if (idx !== -1) notes.value[idx] = updated
  // Re-sort: pinned first
  notes.value.sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned))
}

async function deleteNote(note: Note) {
  await db.deleteNote(note.id)
  notes.value = notes.value.filter((n) => n.id !== note.id)
  toast.add({ title: 'Note deleted', color: 'success' })
}

async function toggleStar() {
  if (!contact.value) return
  const updated = await db.toggleStarContact(contact.value.id)
  contact.value = { ...contact.value, ...updated }
}

async function markContacted() {
  if (!contact.value) return
  await db.markContacted(contact.value.id)
  const updated = await db.getContactDetail(contact.value.id)
  contact.value = updated
  toast.add({ title: 'Marked as contacted', color: 'success' })
}

async function toggleTask(task: Task) {
  const updated = await db.toggleTask(task.id)
  const idx = tasks.value.findIndex((t) => t.id === task.id)
  if (idx !== -1) tasks.value[idx] = updated
}

async function markGiftGiven(gift: GiftNote) {
  await db.markGiftGiven(gift.id)
  const idx = giftNotes.value.findIndex((g) => g.id === gift.id)
  if (idx !== -1) giftNotes.value[idx] = { ...giftNotes.value[idx], is_given: true }
  toast.add({ title: 'Gift marked as given', color: 'success' })
}

// Unified timeline items
type TimelineItem =
  | { kind: 'interaction'; date: string; data: InteractionWithContacts }
  | { kind: 'note'; date: string; data: Note }
  | { kind: 'life_event'; date: string; data: LifeEvent }

const timeline = computed((): TimelineItem[] => {
  const items: TimelineItem[] = [
    ...interactions.value.map((i) => ({
      kind: 'interaction' as const,
      date: i.happened_at,
      data: i,
    })),
    ...notes.value
      .filter((n) => !n.is_pinned)
      .map((n) => ({
        kind: 'note' as const,
        date: n.updated_at,
        data: n,
      })),
    ...lifeEvents.value
      .filter((le) => le.happened_at)
      .map((le) => ({
        kind: 'life_event' as const,
        date: le.happened_at!,
        data: le,
      })),
  ]
  return items.sort((a, b) => b.date.localeCompare(a.date))
})

const pinnedNotes = computed(() => notes.value.filter((n) => n.is_pinned))
</script>

<template>
  <div v-if="loading" class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <USkeleton class="h-24 rounded-xl" />
    <USkeleton class="h-40 rounded-xl" />
  </div>

  <div v-else-if="!contact" class="max-w-2xl mx-auto px-4 py-6 text-center py-16">
    <p class="text-zinc-500">Contact not found</p>
    <UButton to="/contacts" class="mt-4" variant="soft" color="violet">Back to contacts</UButton>
  </div>

  <div v-else class="max-w-2xl mx-auto pb-6">
    <!-- Header -->
    <div class="px-4 pt-6 mb-6">
      <div class="flex items-center gap-3 mb-4">
        <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/contacts" />
        <div class="flex-1" />
        <UButton
          :icon="contact.is_starred ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
          :color="contact.is_starred ? 'violet' : 'neutral'"
          variant="ghost"
          @click="toggleStar"
        />
        <UButton icon="i-heroicons-pencil" variant="ghost" color="neutral" :to="`/contacts/${contact.id}/edit`" />
      </div>

      <!-- Avatar + name -->
      <div class="flex items-center gap-4">
        <div
          class="size-16 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 font-semibold text-xl shrink-0"
        >
          {{ contactInitials(contact) }}
        </div>
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-zinc-100 truncate">
            {{ contactDisplayName(contact) }}
          </h1>
          <p v-if="contact.pronouns" class="text-sm text-zinc-500">{{ contact.pronouns }}</p>
          <p v-if="contact.birthday" class="text-sm text-zinc-500 flex items-center gap-1.5">
            <UIcon name="i-heroicons-cake" class="size-3.5 shrink-0"
              :class="daysUntilBirthday(contact.birthday, today) <= 7 ? 'text-violet-400' : ''"
            />
            <span>{{ formatDate(contact.birthday) }}</span>
            <span v-if="daysUntilBirthday(contact.birthday, today) <= 7" class="text-violet-400">
              · {{ daysUntilBirthday(contact.birthday, today) === 0 ? 'Today!' : `in ${daysUntilBirthday(contact.birthday, today)}d` }}
              (turning {{ turningAge(contact.birthday, today) }})
            </span>
          </p>
          <p v-if="contact.is_deceased" class="text-sm text-zinc-500 italic">
            Deceased{{ contact.deceased_at ? ` · ${formatDate(contact.deceased_at)}` : '' }}
          </p>
        </div>
      </div>
    </div>

    <div class="space-y-4 px-4">
      <!-- Contact fields -->
      <div v-if="contact.fields.length > 0" class="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
        <div v-for="field in contact.fields" :key="field.id" class="flex items-center gap-3 px-4 py-3">
          <UIcon :name="field.type.icon" class="size-4 text-zinc-500 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-zinc-500">{{ field.type.name }}</p>
            <p class="text-zinc-200 truncate">{{ field.value }}</p>
          </div>
        </div>
      </div>

      <!-- How we met -->
      <div v-if="contact.how_we_met" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-1">How we met</p>
        <p class="text-zinc-200 text-sm">{{ contact.how_we_met }}</p>
      </div>

      <!-- Current occupation -->
      <div v-if="contact.current_occupation" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-1">Works at</p>
        <p class="text-zinc-200 font-medium">
          {{ contact.current_occupation.title || 'Employee' }}
          <NuxtLink
            v-if="contact.current_occupation.company"
            :to="`/companies/${contact.current_occupation.company_id}`"
            class="text-violet-400 hover:text-violet-300"
          >
            · {{ contact.current_occupation.company.name }}
          </NuxtLink>
        </p>
      </div>

      <!-- Stay-in-touch -->
      <div
        v-if="contact.stay_in_touch"
        class="bg-zinc-900 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <div>
          <p class="text-xs text-zinc-500 mb-0.5">Stay in touch</p>
          <p class="text-sm text-zinc-200">
            Every {{ contact.stay_in_touch.frequency_days }} days ·
            <span
              :class="
                contact.stay_in_touch.next_remind_at <= today
                  ? 'text-red-400'
                  : 'text-zinc-400'
              "
            >
              {{ contact.stay_in_touch.next_remind_at <= today ? 'Overdue' : `Next: ${formatDateRelative(contact.stay_in_touch.next_remind_at, today)}` }}
            </span>
          </p>
        </div>
        <UButton size="xs" variant="soft" color="violet" @click="markContacted">
          I reached out
        </UButton>
      </div>

      <!-- Pets -->
      <div v-if="contact.pets.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Pets</p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="pet in contact.pets"
            :key="pet.id"
            class="text-sm bg-zinc-800 rounded-full px-3 py-1 text-zinc-200"
          >
            {{ pet.name }}{{ pet.species ? ` (${pet.species})` : '' }}
          </span>
        </div>
      </div>

      <!-- Quick note -->
      <div class="bg-zinc-900 rounded-xl px-4 py-3 space-y-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Quick note</p>
        <div class="flex gap-2">
          <UTextarea
            v-model="newNote"
            placeholder="Add a note…"
            class="flex-1"
            rows="2"
            @keydown.meta.enter="addNote"
          />
          <UButton
            icon="i-heroicons-paper-airplane"
            variant="soft"
            color="violet"
            :loading="savingNote"
            :disabled="!newNote.trim()"
            @click="addNote"
          />
        </div>
      </div>

      <!-- Pinned notes -->
      <div v-if="pinnedNotes.length > 0" class="space-y-2">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pinned notes</p>
        <div
          v-for="note in pinnedNotes"
          :key="note.id"
          class="bg-violet-950/40 border border-violet-900/40 rounded-xl px-4 py-3"
        >
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ note.body }}</p>
          <div class="flex items-center gap-2 mt-2">
            <p class="text-xs text-zinc-600 flex-1">{{ formatRelativeTime(note.updated_at) }}</p>
            <UButton size="xs" variant="ghost" icon="i-heroicons-pin-slash" @click="togglePin(note)" />
            <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="deleteNote(note)" />
          </div>
        </div>
      </div>

      <!-- Addresses -->
      <div v-if="contact.addresses.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Addresses</p>
        <div class="space-y-2">
          <div v-for="addr in contact.addresses" :key="addr.id" class="text-sm text-zinc-300">
            {{ addressOneLiner(addr) }}
          </div>
        </div>
      </div>

      <!-- Tags -->
      <div v-if="contact.tags.length > 0" class="flex flex-wrap gap-2">
        <span
          v-for="tag in contact.tags"
          :key="tag"
          class="text-xs bg-violet-900/40 text-violet-300 rounded-full px-2.5 py-1"
        >
          {{ tag }}
        </span>
      </div>

      <!-- Relationships -->
      <div v-if="contact.relationships.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Relationships</p>
        <div class="space-y-2">
          <NuxtLink
            v-for="rel in contact.relationships"
            :key="rel.id"
            :to="`/contacts/${rel.related.id}`"
            class="flex items-center gap-3 hover:text-violet-300 transition-colors"
          >
            <div class="flex-1 min-w-0">
              <span class="text-zinc-400 text-xs capitalize">
                {{ getRelationshipLabel(rel, rel.type, contact.id) }}
              </span>
              <p class="text-sm text-zinc-200 font-medium truncate">
                {{ contactDisplayName(rel.related) }}
              </p>
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- Past occupations -->
      <div v-if="contact.past_occupations.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Past positions</p>
        <div class="space-y-2">
          <div v-for="occ in contact.past_occupations" :key="occ.id" class="text-sm text-zinc-400">
            <span>{{ occ.title || 'Employee' }}</span>
            <span v-if="occ.company"> · {{ occ.company.name }}</span>
            <span v-if="occ.started_at" class="text-zinc-600 ml-1">
              ({{ occ.started_at.slice(0, 4) }}{{ occ.ended_at ? `–${occ.ended_at.slice(0, 4)}` : '' }})
            </span>
          </div>
        </div>
      </div>

      <!-- Reminders -->
      <div v-if="reminders.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Reminders</p>
        <div class="space-y-2">
          <div
            v-for="r in reminders.filter((r) => !r.is_done)"
            :key="r.id"
            class="flex items-center gap-2"
          >
            <UIcon name="i-heroicons-bell" class="size-4 shrink-0" :class="r.remind_at <= today ? 'text-red-400' : 'text-zinc-500'" />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-zinc-200 truncate">{{ r.title }}</p>
              <p class="text-xs text-zinc-500">
                {{ formatDateRelative(r.remind_at, today) }}{{ r.is_yearly ? ' · yearly' : '' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Tasks -->
      <div v-if="tasks.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Tasks</p>
        <div class="space-y-2">
          <div v-for="t in tasks" :key="t.id" class="flex items-center gap-2">
            <UCheckbox :model-value="t.is_done" @update:model-value="toggleTask(t)" />
            <span class="text-sm flex-1 truncate" :class="t.is_done ? 'line-through text-zinc-600' : 'text-zinc-200'">
              {{ t.title }}
            </span>
            <span v-if="t.due_at && !t.is_done" class="text-xs text-zinc-500 shrink-0">
              {{ formatDateRelative(t.due_at, today) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Gift notes -->
      <div v-if="giftNotes.length > 0" class="bg-zinc-900 rounded-xl px-4 py-3">
        <p class="text-xs text-zinc-500 mb-2">Gift ideas</p>
        <div class="space-y-2">
          <div v-for="g in giftNotes" :key="g.id" class="flex items-center gap-2">
            <UIcon
              :name="g.is_given ? 'i-heroicons-gift-solid' : 'i-heroicons-gift'"
              class="size-4 shrink-0"
              :class="g.is_given ? 'text-zinc-600' : 'text-violet-400'"
            />
            <span class="flex-1 text-sm truncate" :class="g.is_given ? 'line-through text-zinc-600' : 'text-zinc-200'">
              {{ g.idea }}
            </span>
            <span v-if="g.occasion" class="text-xs text-zinc-500 shrink-0">{{ g.occasion }}</span>
            <UButton
              v-if="!g.is_given"
              size="xs"
              variant="ghost"
              color="violet"
              icon="i-heroicons-check"
              @click="markGiftGiven(g)"
            />
          </div>
        </div>
      </div>

      <!-- Log interaction button -->
      <UButton
        :to="`/contacts/${contact.id}/interactions/new`"
        color="violet"
        variant="soft"
        icon="i-heroicons-plus"
        class="w-full"
      >
        Log interaction
      </UButton>

      <!-- Timeline -->
      <div v-if="timeline.length > 0" class="space-y-2">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Timeline</p>
        <div
          v-for="item in timeline"
          :key="`${item.kind}-${item.data.id}`"
          class="bg-zinc-900 rounded-xl px-4 py-3"
        >
          <!-- Interaction -->
          <template v-if="item.kind === 'interaction'">
            <div class="flex items-start gap-3">
              <UIcon
                :name="interactionIcon(item.data.type)"
                class="size-4 text-violet-400 mt-0.5 shrink-0"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-zinc-200">
                  {{ interactionSummary(item.data) }}
                </p>
                <p v-if="item.data.notes" class="text-sm text-zinc-400 mt-1 whitespace-pre-wrap">
                  {{ item.data.notes }}
                </p>
                <p class="text-xs text-zinc-600 mt-1">
                  {{ formatRelativeTime(item.data.happened_at) }}
                </p>
              </div>
            </div>
          </template>

          <!-- Note -->
          <template v-else-if="item.kind === 'note'">
            <div class="flex items-start gap-3">
              <UIcon name="i-heroicons-document-text" class="size-4 text-zinc-500 mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="text-sm text-zinc-300 whitespace-pre-wrap">{{ item.data.body }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <p class="text-xs text-zinc-600 flex-1">{{ formatRelativeTime(item.data.updated_at) }}</p>
                  <UButton size="xs" variant="ghost" icon="i-heroicons-pin" @click="togglePin(item.data)" />
                  <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="deleteNote(item.data)" />
                </div>
              </div>
            </div>
          </template>

          <!-- Life event -->
          <template v-else-if="item.kind === 'life_event'">
            <div class="flex items-start gap-3">
              <UIcon name="i-heroicons-sparkles" class="size-4 text-amber-400 mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-zinc-200">{{ item.data.label || 'Life event' }}</p>
                <p v-if="item.data.notes" class="text-sm text-zinc-400">{{ item.data.notes }}</p>
                <p class="text-xs text-zinc-600 mt-1">{{ formatDate(item.data.happened_at) }}</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
