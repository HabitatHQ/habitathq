<script setup lang="ts">
import type { BoredCategory, BoredActivity } from '~/types/database'

const db = useDatabase()

const categories = ref<BoredCategory[]>([])
const activities = ref<BoredActivity[]>([])

const showCategoryModal = ref(false)
const showActivityModal = ref(false)
const editingCategory = ref<BoredCategory | null>(null)
const editingActivity = ref<BoredActivity | null>(null)
const activityCategoryId = ref<string>('')
const saving = ref(false)

// Category form
const catForm = reactive({ name: '', icon: 'i-heroicons-sparkles', color: '#6366f1' })

// Activity form
const actForm = reactive({
  title: '',
  description: '',
  estimated_minutes: '' as string | number,
  is_recurring: false,
  recurrence_rule: 'daily' as 'daily' | 'weekly' | 'monthly',
  tags: '',
})

async function load() {
  ;[categories.value, activities.value] = await Promise.all([
    db.getBoredCategories(),
    db.getBoredActivities(),
  ])
}

onMounted(load)

function activitiesForCategory(catId: string) {
  return activities.value.filter(a => a.category_id === catId)
}

function openAddActivity(catId: string) {
  activityCategoryId.value = catId
  editingActivity.value = null
  Object.assign(actForm, { title: '', description: '', estimated_minutes: '', is_recurring: false, recurrence_rule: 'daily', tags: '' })
  showActivityModal.value = true
}

function openEditActivity(a: BoredActivity) {
  editingActivity.value = a
  activityCategoryId.value = a.category_id
  Object.assign(actForm, {
    title: a.title,
    description: a.description,
    estimated_minutes: a.estimated_minutes ?? '',
    is_recurring: a.is_recurring,
    recurrence_rule: a.recurrence_rule ?? 'daily',
    tags: a.tags.join(', '),
  })
  showActivityModal.value = true
}

function openAddCategory() {
  editingCategory.value = null
  Object.assign(catForm, { name: '', icon: 'i-heroicons-sparkles', color: '#6366f1' })
  showCategoryModal.value = true
}

function openEditCategory(c: BoredCategory) {
  editingCategory.value = c
  Object.assign(catForm, { name: c.name, icon: c.icon, color: c.color })
  showCategoryModal.value = true
}

async function saveCategory() {
  if (saving.value) return
  const payload = { name: catForm.name.trim(), icon: catForm.icon, color: catForm.color }
  if (!payload.name) return
  saving.value = true
  try {
    if (editingCategory.value) {
      await db.updateBoredCategory({ id: editingCategory.value.id, ...payload })
    } else {
      await db.createBoredCategory({ ...payload, is_system: false, sort_order: categories.value.length })
    }
    showCategoryModal.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function deleteCategory(c: BoredCategory) {
  if (c.is_system) return
  await db.deleteBoredCategory(c.id)
  await load()
}

async function saveActivity() {
  if (saving.value) return
  const mins = actForm.estimated_minutes !== '' ? Number(actForm.estimated_minutes) : null
  const tags = actForm.tags.split(',').map(t => t.trim()).filter(Boolean)
  const payload = {
    title: actForm.title.trim(),
    description: actForm.description.trim(),
    category_id: activityCategoryId.value,
    estimated_minutes: mins,
    is_recurring: actForm.is_recurring,
    recurrence_rule: actForm.is_recurring ? actForm.recurrence_rule : null,
    tags,
    annotations: {} as Record<string, string>,
  }
  if (!payload.title) return
  saving.value = true
  try {
    if (editingActivity.value) {
      await db.updateBoredActivity({ id: editingActivity.value.id, ...payload })
    } else {
      await db.createBoredActivity(payload)
    }
    showActivityModal.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function deleteActivity(a: BoredActivity) {
  await db.deleteBoredActivity(a.id)
  await load()
}

async function archiveActivity(a: BoredActivity) {
  await db.archiveBoredActivity(a.id)
  await load()
}
</script>

<template>
  <div class="max-w-lg mx-auto space-y-6">
    <div class="flex items-center gap-3">
      <UButton to="/bored" variant="ghost" color="neutral" size="sm" icon="i-heroicons-arrow-left" />
      <h1 class="text-xl font-bold">Manage Activities</h1>
    </div>

    <!-- Category sections -->
    <div v-for="cat in categories" :key="cat.id" class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon :name="cat.icon" class="w-4 h-4" :style="{ color: cat.color }" />
          <span class="font-semibold text-sm">{{ cat.name }}</span>
          <span class="text-xs text-slate-500">({{ activitiesForCategory(cat.id).length }})</span>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            v-if="!cat.is_system"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-heroicons-pencil"
            @click="openEditCategory(cat)"
          />
          <UButton
            v-if="!cat.is_system"
            variant="ghost"
            color="error"
            size="xs"
            icon="i-heroicons-trash"
            @click="deleteCategory(cat)"
          />
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-heroicons-plus"
            @click="openAddActivity(cat.id)"
          />
        </div>
      </div>

      <div class="space-y-1">
        <div
          v-for="act in activitiesForCategory(cat.id)"
          :key="act.id"
          class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" :class="act.is_done ? 'line-through text-slate-500' : ''">
              {{ act.title }}
            </p>
            <div class="flex items-center gap-2 mt-0.5">
              <span v-if="act.estimated_minutes" class="text-xs text-slate-500">
                {{ act.estimated_minutes }}m
              </span>
              <span v-if="act.is_recurring" class="text-xs text-slate-500 flex items-center gap-0.5">
                <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" />
                {{ act.recurrence_rule }}
              </span>
              <span v-if="act.done_count > 0" class="text-xs text-slate-500">
                ×{{ act.done_count }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 ml-2 shrink-0">
            <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-pencil" @click="openEditActivity(act)" />
            <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-archive-box" @click="archiveActivity(act)" />
            <UButton variant="ghost" color="error" size="xs" icon="i-heroicons-trash" @click="deleteActivity(act)" />
          </div>
        </div>
        <div v-if="activitiesForCategory(cat.id).length === 0" class="text-xs text-slate-600 px-1">
          No activities yet.
        </div>
      </div>
    </div>

    <!-- Add custom category -->
    <UButton
      variant="soft"
      color="neutral"
      size="sm"
      icon="i-heroicons-plus"
      class="w-full"
      @click="openAddCategory"
    >
      Add custom category
    </UButton>

    <!-- Category modal -->
    <div v-if="showCategoryModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showCategoryModal = false" />
      <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
        <h2 class="text-lg font-semibold">{{ editingCategory ? 'Edit Category' : 'New Category' }}</h2>
        <div class="space-y-3">
          <UFormField label="Name">
            <UInput v-model="catForm.name" placeholder="Category name" class="w-full" />
          </UFormField>
          <UFormField label="Icon (Heroicons class)">
            <UInput v-model="catForm.icon" placeholder="i-heroicons-sparkles" class="w-full" />
          </UFormField>
          <UFormField label="Color">
            <div class="flex items-center gap-2">
              <input v-model="catForm.color" type="color" class="w-10 h-8 rounded border border-slate-700 bg-transparent cursor-pointer" />
              <UInput v-model="catForm.color" placeholder="#6366f1" class="flex-1" />
            </div>
          </UFormField>
        </div>
        <div class="flex gap-2 pt-1">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showCategoryModal = false">Cancel</UButton>
          <UButton color="primary" class="flex-1" :loading="saving" @click="saveCategory">Save</UButton>
        </div>
      </div>
    </div>

    <!-- Activity modal -->
    <div v-if="showActivityModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showActivityModal = false" />
      <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold">{{ editingActivity ? 'Edit Activity' : 'New Activity' }}</h2>
        <div class="space-y-3">
          <UFormField label="Title" required>
            <UInput v-model="actForm.title" placeholder="Activity title" class="w-full" />
          </UFormField>
          <UFormField label="Description">
            <UTextarea v-model="actForm.description" placeholder="Optional description" class="w-full" />
          </UFormField>
          <UFormField label="Estimated minutes">
            <UInput v-model="actForm.estimated_minutes" type="number" min="1" placeholder="e.g. 20" class="w-full" />
          </UFormField>
          <div class="flex items-center justify-between">
            <span class="text-sm">Recurring</span>
            <USwitch v-model="actForm.is_recurring" />
          </div>
          <div v-if="actForm.is_recurring">
            <UFormField label="Recurrence">
              <div class="flex gap-2">
                <button
                  v-for="rule in ['daily', 'weekly', 'monthly'] as const"
                  :key="rule"
                  class="flex-1 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors"
                  :class="actForm.recurrence_rule === rule ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-300'"
                  @click="actForm.recurrence_rule = rule"
                >
                  {{ rule }}
                </button>
              </div>
            </UFormField>
          </div>
          <UFormField label="Tags (comma-separated)">
            <UInput v-model="actForm.tags" placeholder="tag1, tag2" class="w-full" />
          </UFormField>
        </div>
        <div class="flex gap-2 pt-1">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showActivityModal = false">Cancel</UButton>
          <UButton color="primary" class="flex-1" :loading="saving" @click="saveActivity">Save</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
