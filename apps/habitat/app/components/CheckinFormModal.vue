<script setup lang="ts">
import type { CheckinTemplate } from '~/types/database'

type Schedule = 'DAILY' | 'WEEKLY' | 'MONTHLY'

const props = defineProps<{
  mode: 'create' | 'edit'
  /** Prefill source when editing. */
  template?: CheckinTemplate | null
}>()

const emit = defineEmits<{
  saved: [template: CheckinTemplate]
}>()

const open = defineModel<boolean>({ default: false })

const db = useDatabase()

const DEFAULT_ICON = 'pencil-square'
const DEFAULT_COLOR = '#22d3ee'

const form = reactive({
  title: '',
  schedule_type: 'DAILY' as Schedule,
  days_active: [] as number[],
  icon: DEFAULT_ICON,
  color: DEFAULT_COLOR,
})

const titleError = ref<string | null>(null)
const saving = ref(false)

watch(
  () => form.title,
  () => {
    titleError.value = null
  },
)

function reset() {
  if (props.mode === 'edit' && props.template) {
    form.title = props.template.title
    form.schedule_type = props.template.schedule_type
    form.days_active = props.template.days_active ? [...props.template.days_active] : []
    form.icon = props.template.icon || DEFAULT_ICON
    form.color = props.template.color || DEFAULT_COLOR
  } else {
    form.title = ''
    form.schedule_type = 'DAILY'
    form.days_active = []
    form.icon = DEFAULT_ICON
    form.color = DEFAULT_COLOR
  }
  titleError.value = null
}

// Re-seed the form each time the modal opens.
watch(open, (isOpen) => {
  if (isOpen) reset()
})

async function save() {
  if (saving.value) return
  if (!form.title.trim()) {
    titleError.value = 'Name is required'
    return
  }
  titleError.value = null
  saving.value = true
  try {
    const days_active =
      form.schedule_type === 'WEEKLY' && form.days_active.length ? [...form.days_active] : null
    let result: CheckinTemplate
    if (props.mode === 'edit' && props.template) {
      result = await db.updateCheckinTemplate({
        id: props.template.id,
        title: form.title.trim(),
        schedule_type: form.schedule_type,
        days_active,
        icon: form.icon,
        color: form.color,
      })
    } else {
      result = await db.createCheckinTemplate({
        title: form.title.trim(),
        schedule_type: form.schedule_type,
        days_active,
        icon: form.icon,
        color: form.color,
      })
    }
    emit('saved', result)
    open.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal v-model="open" :title="mode === 'create' ? 'New Check-in' : 'Edit Check-in'">
    <!-- Name -->
    <UFormField label="Name" required>
      <AppTextField
        v-model="form.title"
        placeholder="e.g. Morning Check-in"
        class="w-full"
        autofocus
        @keydown.enter="save"
      />
    </UFormField>
    <p v-if="titleError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
      <AppIcon name="exclamation-circle" class="w-4 h-4 flex-shrink-0" />
      {{ titleError }}
    </p>

    <!-- Color & Icon -->
    <UFormField label="Color">
      <HabitColorPicker v-model="form.color" />
    </UFormField>
    <UFormField label="Icon">
      <HabitIconPicker v-model="form.icon" :color="form.color" />
    </UFormField>

    <!-- Schedule -->
    <UFormField label="Schedule">
      <TypeSelector
        v-model="form.schedule_type"
        :options="[{value:'DAILY',label:'Daily'},{value:'WEEKLY',label:'Weekly'},{value:'MONTHLY',label:'Monthly'}]"
      />
    </UFormField>

    <!-- Days (WEEKLY only) -->
    <UFormField v-if="form.schedule_type === 'WEEKLY'" label="Days (leave blank for every day)">
      <DayPicker v-model="form.days_active" :labels="CHECKIN_DAY_LABELS" />
    </UFormField>

    <template #footer>
      <div class="flex gap-2">
        <UButton variant="soft" color="neutral" class="flex-1" @click="open = false">Cancel</UButton>
        <UButton
          class="flex-1"
          :disabled="!form.title.trim() || saving"
          :loading="saving"
          @click="save"
        >
          {{ mode === 'create' ? 'Create' : 'Save' }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
