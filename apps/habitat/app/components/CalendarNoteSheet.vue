<script setup lang="ts">
import type { Scribble } from '~/types/database'
import { CALENDAR_NOTE_TAG } from '~/utils/jots-helpers'
import { dateForKey } from '~/utils/planner'

type CalendarNotePayload = Pick<
  Scribble,
  'title' | 'content' | 'tags' | 'annotations' | 'entry_date'
>

const props = withDefaults(
  defineProps<{
    open: boolean
    note: Scribble | null
    entryDate: string
    saving?: boolean
  }>(),
  { saving: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [payload: CalendarNotePayload]
  openInJots: [note: Scribble]
}>()

const form = reactive({
  title: '',
  content: '',
  entryDate: '',
})

const isEditing = computed(() => props.note !== null)
const title = computed(() => (isEditing.value ? 'Edit note' : 'Add a note'))
const formattedDate = computed(() =>
  form.entryDate
    ? dateForKey(form.entryDate).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : '',
)
const canSave = computed(() => form.title.trim().length > 0 || form.content.trim().length > 0)

function resetForm() {
  form.title = props.note?.title ?? ''
  form.content = props.note?.content ?? ''
  form.entryDate = props.note?.entry_date ?? props.entryDate
}

function close(open: boolean) {
  emit('update:open', open)
}

function save() {
  if (!canSave.value || props.saving) return
  emit('save', {
    title: form.title.trim(),
    content: form.content.trim(),
    entry_date: form.entryDate,
    tags: props.note?.tags ?? [CALENDAR_NOTE_TAG],
    annotations: props.note?.annotations ?? {},
  })
}

watch(
  () => [props.open, props.note?.id, props.entryDate],
  ([open]) => {
    if (open) resetForm()
  },
  { immediate: true },
)
</script>

<template>
  <AppBottomSheet
    :model-value="open"
    :title="title"
    max-width="md"
    @update:model-value="close"
  >
    <template #title>
      <div>
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <p v-if="formattedDate" class="text-xs text-(--ui-text-dimmed)">{{ formattedDate }}</p>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField label="Title">
        <AppTextField v-model="form.title" placeholder="Title (optional)" class="w-full" />
      </UFormField>
      <UFormField label="Note">
        <AppTextArea
          v-model="form.content"
          placeholder="Write what matters…"
          :rows="6"
          autoresize
          class="w-full"
        />
      </UFormField>
      <UFormField label="Calendar date">
        <AppTextField v-model="form.entryDate" type="date" class="w-full" />
      </UFormField>
      <UButton
        v-if="note"
        variant="ghost"
        color="neutral"
        block
        :icon="resolveIcon('arrow-top-right-on-square')"
        @click="emit('openInJots', note)"
      >
        Open in Jots
      </UButton>
    </div>

    <template #footer>
      <div class="flex gap-3">
        <UButton variant="ghost" color="neutral" class="flex-1 justify-center" @click="close(false)">
          Cancel
        </UButton>
        <UButton
          color="primary"
          class="flex-1 justify-center"
          :disabled="!canSave"
          :loading="saving"
          @click="save"
        >
          {{ isEditing ? 'Save changes' : 'Add note' }}
        </UButton>
      </div>
    </template>
  </AppBottomSheet>
</template>
