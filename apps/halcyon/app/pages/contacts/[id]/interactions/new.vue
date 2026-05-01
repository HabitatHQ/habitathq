<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Contact, ConversationChannel, InteractionType } from '~/types/database'
import { contactDisplayName } from '~/utils/contact-helpers'
import { localDateString } from '~/utils/format'

const route = useRoute()
const router = useRouter()
const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()

const contact = ref<Contact | null>(null)
const saving = ref(false)
const additionalContacts = ref<Contact[]>([])
const allContacts = ref<Contact[]>([])
const searchAdd = ref('')

const today = localDateString(new Date())

const form = reactive({
  type: 'conversation' as InteractionType,
  channel: 'in-person' as ConversationChannel,
  subject: '',
  notes: '',
  happened_at: `${today}T${new Date().toTimeString().slice(0, 5)}`,
  duration_minutes: '' as string | number,
})

const typeOptions: { label: string; value: InteractionType }[] = [
  { label: 'Conversation', value: 'conversation' },
  { label: 'Call', value: 'call' },
  { label: 'Activity', value: 'activity' },
  { label: 'Meeting', value: 'meeting' },
]

const channelOptions: { label: string; value: ConversationChannel }[] = [
  { label: 'In person', value: 'in-person' },
  { label: 'WhatsApp', value: 'whatsapp' },
  { label: 'SMS', value: 'sms' },
  { label: 'Email', value: 'email' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Facebook', value: 'facebook' },
  { label: 'Other', value: 'other' },
]

const showChannel = computed(() => form.type === 'conversation')
const showDuration = computed(() => form.type === 'call' || form.type === 'meeting')

async function load() {
  const id = route.params['id'] as string
  contact.value = await db.getContact(id)
  if (activeVaultId.value) {
    allContacts.value = await db.getContacts(activeVaultId.value)
  }
}

onMounted(load)

const filteredAdd = computed(() => {
  const id = route.params['id'] as string
  const q = searchAdd.value.toLowerCase()
  return allContacts.value
    .filter(
      (c) =>
        c.id !== id &&
        !additionalContacts.value.some((a) => a.id === c.id) &&
        contactDisplayName(c).toLowerCase().includes(q),
    )
    .slice(0, 5)
})

function addContact(c: Contact) {
  additionalContacts.value.push(c)
  searchAdd.value = ''
}

function removeAdditional(c: Contact) {
  additionalContacts.value = additionalContacts.value.filter((a) => a.id !== c.id)
}

async function save() {
  if (!contact.value || !activeVaultId.value) return
  saving.value = true
  try {
    const contact_ids = [
      contact.value.id,
      ...additionalContacts.value.map((c) => c.id),
    ]
    await db.createInteraction({
      vault_id: activeVaultId.value,
      type: form.type,
      channel: showChannel.value ? form.channel : null,
      subject: form.subject.trim(),
      notes: form.notes.trim(),
      happened_at: new Date(form.happened_at).toISOString(),
      duration_minutes: showDuration.value && form.duration_minutes ? Number(form.duration_minutes) : null,
      contact_ids,
    })
    toast.add({ title: 'Interaction logged', color: 'success' })
    await router.push(`/contacts/${contact.value.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center gap-3 mb-6">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        color="neutral"
        :to="`/contacts/${route.params['id']}`"
      />
      <div>
        <h1 class="text-xl font-semibold text-zinc-100">Log interaction</h1>
        <p v-if="contact" class="text-sm text-zinc-500">with {{ contactDisplayName(contact) }}</p>
      </div>
    </div>

    <form class="space-y-4" @submit.prevent="save">
      <!-- Type -->
      <UFormField label="Type">
        <div class="flex gap-2 flex-wrap">
          <UButton
            v-for="opt in typeOptions"
            :key="opt.value"
            :variant="form.type === opt.value ? 'solid' : 'soft'"
            :color="form.type === opt.value ? 'violet' : 'neutral'"
            size="sm"
            @click="form.type = opt.value"
          >
            {{ opt.label }}
          </UButton>
        </div>
      </UFormField>

      <!-- Channel (conversation only) -->
      <UFormField v-if="showChannel" label="Channel">
        <USelect v-model="form.channel" :options="channelOptions" class="w-full" />
      </UFormField>

      <!-- Subject -->
      <UFormField label="Subject">
        <UInput v-model="form.subject" placeholder="What was it about?" class="w-full" />
      </UFormField>

      <!-- Notes -->
      <UFormField label="Notes">
        <UTextarea v-model="form.notes" placeholder="What happened?" class="w-full" rows="4" />
      </UFormField>

      <!-- When -->
      <UFormField label="When">
        <UInput v-model="form.happened_at" type="datetime-local" class="w-full" />
      </UFormField>

      <!-- Duration (call/meeting) -->
      <UFormField v-if="showDuration" label="Duration (minutes)">
        <UInput v-model="form.duration_minutes" type="number" placeholder="30" class="w-full" />
      </UFormField>

      <!-- Additional contacts -->
      <UFormField label="Also with…">
        <div class="space-y-2">
          <div v-if="additionalContacts.length > 0" class="flex flex-wrap gap-1">
            <UBadge
              v-for="c in additionalContacts"
              :key="c.id"
              variant="soft"
              color="violet"
              class="cursor-pointer"
              @click="removeAdditional(c)"
            >
              {{ contactDisplayName(c) }} ×
            </UBadge>
          </div>
          <UInput v-model="searchAdd" placeholder="Add another person…" class="w-full" />
          <ul v-if="filteredAdd.length > 0" class="bg-zinc-800 rounded-lg overflow-hidden">
            <li
              v-for="c in filteredAdd"
              :key="c.id"
              class="px-3 py-2 cursor-pointer hover:bg-zinc-700 text-sm text-zinc-200"
              @click="addContact(c)"
            >
              {{ contactDisplayName(c) }}
            </li>
          </ul>
        </div>
      </UFormField>

      <div class="pt-2">
        <UButton type="submit" color="violet" class="w-full" :loading="saving">
          Save
        </UButton>
      </div>
    </form>
  </div>
</template>
