<script setup lang="ts">
import type { BoredCategory, Todo } from '~/types/database'
import { buildTodoPayload, validateTodoForm } from '~/utils/todos-helpers'

const props = withDefaults(
  defineProps<{
    open: boolean
    editingTodo: Todo | null
    boredCategories: BoredCategory[]
    suggestTags: (query: string) => string[]
    defaultDate?: string
  }>(),
  { defaultDate: '' },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [payload: ReturnType<typeof buildTodoPayload>]
  delete: [todo: Todo]
  'todo-updated': [todo: Todo]
}>()

const db = useDatabase()
const { impact, selectionChanged } = useHaptics()

const form = reactive({
  title: '',
  description: '',
  due_date: '',
  priority: 'medium' as 'high' | 'medium' | 'low',
  estimated_minutes: '' as string | number,
  is_recurring: false,
  recurrence_rule: 'daily' as 'daily' | 'weekly' | 'monthly',
  show_in_bored: false,
  bored_category_id: '' as string,
  tags: [] as string[],
})

const titleError = ref<string | null>(null)
watch(
  () => form.title,
  () => {
    titleError.value = null
  },
)

// Reset form when modal opens/closes or editingTodo changes
watch(
  () => [props.open, props.editingTodo] as const,
  ([open, todo]) => {
    if (!open) {
      titleError.value = null
      showJotPicker.value = false
      jotPickerItems.value = []
      return
    }
    if (todo) {
      Object.assign(form, {
        title: todo.title,
        description: todo.description,
        due_date: todo.due_date ?? '',
        priority: todo.priority,
        estimated_minutes: todo.estimated_minutes ?? '',
        is_recurring: todo.is_recurring,
        recurrence_rule: todo.recurrence_rule ?? 'daily',
        show_in_bored: todo.show_in_bored,
        bored_category_id: todo.bored_category_id ?? '',
        tags: [...todo.tags],
      })
    } else {
      Object.assign(form, {
        title: '',
        description: '',
        due_date: props.defaultDate,
        priority: 'medium',
        estimated_minutes: '',
        is_recurring: false,
        recurrence_rule: 'daily',
        show_in_bored: false,
        bored_category_id: '',
        tags: [],
      })
    }
    showJotPicker.value = false
    jotPickerItems.value = []
  },
)

function handleSave() {
  const validationError = validateTodoForm(form)
  if (validationError) {
    titleError.value = validationError
    return
  }
  titleError.value = null
  const payload = buildTodoPayload(form, props.editingTodo?.annotations ?? null)
  emit('save', payload)
}

// ── Jot picker ───────────────────────────────────────────────────────────────

interface JotPickerItem {
  kind: 'text' | 'voice' | 'image'
  id: string
  label: string
}

const showJotPicker = ref(false)
const jotPickerItems = ref<JotPickerItem[]>([])
const loadingJotPicker = ref(false)
const unlinkingJot = ref(false)
const toast = useToast()

async function openJotPicker() {
  showJotPicker.value = true
  if (jotPickerItems.value.length > 0) return
  loadingJotPicker.value = true
  try {
    const [scribbles, voices, images] = await Promise.all([
      db.getScribbles(),
      db.getVoiceNotes(),
      db.getImageNotes(),
    ])
    jotPickerItems.value = [
      ...scribbles.map((s) => ({
        kind: 'text' as const,
        id: s.id,
        label: s.title || s.content.slice(0, 60) || 'Untitled jot',
      })),
      ...voices.map((v) => ({
        kind: 'voice' as const,
        id: v.id,
        label: `Voice note — ${v.created_at.slice(0, 10)}`,
      })),
      ...images.map((i) => ({ kind: 'image' as const, id: i.id, label: i.filename })),
    ]
  } catch (err) {
    logError('[openJotPicker]', err)
    toast.add({ title: 'Failed to load jots', color: 'error', duration: 4000 })
  } finally {
    loadingJotPicker.value = false
  }
}

async function selectJot(item: JotPickerItem) {
  if (!props.editingTodo) return
  const updated = await db.updateTodo({
    id: props.editingTodo.id,
    annotations: {
      ...props.editingTodo.annotations,
      linked_jot_id: item.id,
      linked_jot_kind: item.kind,
      linked_jot_title: item.label,
    },
  })
  emit('todo-updated', updated)
  showJotPicker.value = false
}

async function unlinkJot() {
  if (!props.editingTodo || unlinkingJot.value) return
  unlinkingJot.value = true
  try {
    const filteredAnnotations: Record<string, string> = Object.fromEntries(
      Object.entries(props.editingTodo.annotations).filter(
        ([k]) => k !== 'linked_jot_id' && k !== 'linked_jot_kind' && k !== 'linked_jot_title',
      ),
    )
    const updated = await db.updateTodo({
      id: props.editingTodo.id,
      annotations: filteredAnnotations,
    })
    emit('todo-updated', updated)
  } finally {
    unlinkingJot.value = false
  }
}

function jotKindIcon(kind: string | undefined): string {
  if (kind === 'voice') return resolveIcon('microphone')
  if (kind === 'image') return resolveIcon('photo')
  return resolveIcon('pencil')
}
</script>

<template>
  <AppModal :model-value="open" @update:model-value="emit('update:open', $event)">
    <h2 class="text-lg font-semibold">{{ editingTodo ? 'Edit TODO' : 'New TODO' }}</h2>

    <div class="space-y-3">
      <UFormField label="Title" required>
        <AppTextField v-model="form.title" placeholder="What needs doing?" class="w-full" autofocus />
      </UFormField>
      <p v-if="titleError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
        <AppIcon name="exclamation-circle" class="w-3.5 h-3.5 flex-shrink-0" />
        {{ titleError }}
      </p>

      <UFormField label="Description">
        <AppTextArea v-model="form.description" placeholder="Optional details" class="w-full" />
      </UFormField>

      <UFormField label="Due date">
        <AppTextField v-model="form.due_date" type="date" class="w-full" />
      </UFormField>

      <UFormField label="Priority">
        <div class="flex gap-2">
          <button
            v-for="p in [['high', 'High', 'bg-red-600'], ['medium', 'Medium', 'bg-amber-600'], ['low', 'Low', 'bg-slate-600']] as const"
            :key="p[0]"
            class="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
            :class="form.priority === p[0] ? p[2] + ' text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
            @click="form.priority = p[0]; selectionChanged()"
          >
            {{ p[1] }}
          </button>
        </div>
      </UFormField>

      <UFormField label="Estimated minutes">
        <AppTextField v-model="form.estimated_minutes" type="number" min="1" placeholder="e.g. 30" class="w-full" />
      </UFormField>

      <div class="flex items-center justify-between">
        <span class="text-sm">Recurring</span>
        <USwitch :model-value="form.is_recurring" @update:model-value="v => { form.is_recurring = v; impact('light') }" />
      </div>
      <div v-if="form.is_recurring">
        <UFormField label="Recurrence">
          <div class="flex gap-2">
            <button
              v-for="rule in ['daily', 'weekly', 'monthly'] as const"
              :key="rule"
              class="flex-1 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors"
              :class="form.recurrence_rule === rule ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
              @click="form.recurrence_rule = rule"
            >
              {{ rule }}
            </button>
          </div>
        </UFormField>
      </div>

      <UFormField label="Tags">
        <TagInput v-model="form.tags" :suggest="suggestTags" />
      </UFormField>

      <div class="flex items-center justify-between">
        <span class="text-sm">Show in Bored mode</span>
        <USwitch v-model="form.show_in_bored" />
      </div>
      <div v-if="form.show_in_bored && boredCategories.length">
        <UFormField label="Bored category (optional)">
          <select
            v-model="form.bored_category_id"
            class="w-full bg-(--ui-bg-elevated) border border-(--ui-border-accented) rounded-lg px-3 py-2 text-sm text-(--ui-text)"
          >
            <option value="">None</option>
            <option v-for="cat in boredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </UFormField>
      </div>
    </div>

    <!-- Linked jot (only shown when editing) -->
    <div v-if="editingTodo" class="border-t border-(--ui-border) pt-3 space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">Linked Jot</p>

      <!-- Has a linked jot -->
      <div v-if="editingTodo.annotations['linked_jot_id']" class="flex items-center gap-2.5 p-2.5 rounded-xl bg-(--ui-bg-elevated) border border-(--ui-border-accented)">
        <AppIcon
          :name="jotKindIcon(editingTodo.annotations['linked_jot_kind'])"
          class="w-4 h-4 text-(--ui-text-muted) shrink-0"
        />
        <span class="flex-1 text-sm text-(--ui-text-toned) truncate min-w-0">
          {{ editingTodo.annotations['linked_jot_title'] || editingTodo.annotations['linked_jot_id'] }}
        </span>
        <UButton
          :icon="resolveIcon('arrow-top-right-on-square')"
          size="xs"
          variant="ghost"
          color="neutral"
          title="Go to Jots"
          @click="emit('update:open', false); navigateTo('/jots')"
        />
        <UButton
          :icon="resolveIcon('x-mark')"
          size="xs"
          variant="ghost"
          color="error"
          title="Remove link"
          :loading="unlinkingJot"
          @click="unlinkJot"
        />
      </div>

      <!-- No linked jot -->
      <button
        v-else
        class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors py-1"
        @click="openJotPicker"
      >
        <AppIcon name="link" class="w-3.5 h-3.5" />
        Link a jot
      </button>

      <!-- Jot picker -->
      <div v-if="showJotPicker && !editingTodo.annotations['linked_jot_id']" class="border border-(--ui-border-accented) rounded-xl overflow-hidden">
        <div v-if="loadingJotPicker" class="p-4 text-center text-xs text-(--ui-text-dimmed)">Loading jots…</div>
        <div v-else-if="jotPickerItems.length === 0" class="p-4 text-center text-xs text-(--ui-text-dimmed)">No jots found.</div>
        <ul v-else class="divide-y divide-(--ui-border) max-h-48 overflow-y-auto overscroll-contain">
          <li
            v-for="jot in jotPickerItems"
            :key="jot.kind + '-' + jot.id"
            class="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-(--ui-bg-elevated) transition-colors"
            @click="selectJot(jot)"
          >
            <AppIcon :name="jotKindIcon(jot.kind)" class="w-3.5 h-3.5 text-(--ui-text-muted) shrink-0" />
            <span class="text-sm text-(--ui-text-toned) truncate">{{ jot.label }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="flex gap-2 pt-1">
      <UButton variant="soft" color="neutral" class="flex-1" @click="emit('update:open', false)">Cancel</UButton>
      <UButton
        v-if="editingTodo"
        variant="ghost"
        color="error"
        class="flex-none"
        :icon="resolveIcon('trash')"
        @click="emit('delete', editingTodo)"
      />
      <UButton color="primary" class="flex-1" @click="handleSave">Save</UButton>
    </div>
    <div class="safe-area-bottom" aria-hidden="true" />
  </AppModal>
</template>
