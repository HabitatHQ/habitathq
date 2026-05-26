<script setup lang="ts">
import type { BoredActivity, BoredCategory } from '~/types/database'
import {
  buildActivityPayload,
  buildCategoryPayload,
  validateActivityTitle,
} from '~/utils/bored-helpers'

const db = useDatabase()
const toast = useToast()

const categories = ref<BoredCategory[]>([])
const activities = ref<BoredActivity[]>([])

const showCategoryModal = useBoolModalQuery('add-category')
const showActivityModal = useBoolModalQuery('add-activity')
const editingCategory = ref<BoredCategory | null>(null)
const editingActivity = ref<BoredActivity | null>(null)
const activityCategoryId = ref<string>('')
const saving = ref(false)

// Confirm dialogs
const confirmDeleteActivity = ref<BoredActivity | null>(null)
const confirmDeleteCategory = ref<BoredCategory | null>(null)

// Inline validation
const activityTitleError = ref<string | null>(null)
const categoryNameError = ref<string | null>(null)

// Category form
const catForm = reactive({ name: '', icon: 'sparkles', color: '#6366f1' })

// Activity form
const actForm = reactive({
  title: '',
  description: '',
  estimated_minutes: '' as string | number,
  is_recurring: false,
  recurrence_rule: 'daily' as 'daily' | 'weekly' | 'monthly',
  tags: [] as string[],
})

const boredCategoryNames = computed(() => categories.value.map((c) => c.name))
const { loadTags, suggest: suggestBoredTags } = useTagSuggestions('bored', boredCategoryNames)

async function load() {
  ;[categories.value, activities.value] = await Promise.all([
    db.getBoredCategories(),
    db.getBoredActivities(),
  ])
}

onMounted(() => {
  void load()
  void loadTags()
})

function activitiesForCategory(catId: string) {
  return activities.value.filter((a) => a.category_id === catId)
}

function openAddActivity(catId: string) {
  activityCategoryId.value = catId
  editingActivity.value = null
  activityTitleError.value = null
  Object.assign(actForm, {
    title: '',
    description: '',
    estimated_minutes: '',
    is_recurring: false,
    recurrence_rule: 'daily',
    tags: [],
  })
  showActivityModal.value = true
}

function openEditActivity(a: BoredActivity) {
  editingActivity.value = a
  activityCategoryId.value = a.category_id
  activityTitleError.value = null
  Object.assign(actForm, {
    title: a.title,
    description: a.description,
    estimated_minutes: a.estimated_minutes ?? '',
    is_recurring: a.is_recurring,
    recurrence_rule: a.recurrence_rule ?? 'daily',
    tags: [...a.tags],
  })
  showActivityModal.value = true
}

function openAddCategory() {
  editingCategory.value = null
  categoryNameError.value = null
  Object.assign(catForm, { name: '', icon: 'sparkles', color: '#6366f1' })
  showCategoryModal.value = true
}

function openEditCategory(c: BoredCategory) {
  editingCategory.value = c
  categoryNameError.value = null
  Object.assign(catForm, { name: c.name, icon: c.icon, color: c.color })
  showCategoryModal.value = true
}

async function saveCategory() {
  if (saving.value) return
  const validationError = validateActivityTitle(catForm.name)
  if (validationError) {
    categoryNameError.value = validationError
    return
  }
  categoryNameError.value = null
  const payload = buildCategoryPayload(catForm)
  saving.value = true
  try {
    if (editingCategory.value) {
      await db.updateBoredCategory({ id: editingCategory.value.id, ...payload })
    } else {
      await db.createBoredCategory({
        ...payload,
        is_system: false,
        sort_order: categories.value.length,
      })
    }
    showCategoryModal.value = false
    await load()
  } catch (err) {
    logError('[saveCategory]', err)
    toast.add({ title: 'Failed to save category', color: 'error', duration: 4000 })
  } finally {
    saving.value = false
  }
}

async function deleteCategory(c: BoredCategory) {
  if (c.is_system) return
  try {
    await db.deleteBoredCategory(c.id)
    await load()
    toast.add({ title: 'Category deleted', color: 'success', duration: 2000 })
  } catch (err) {
    logError('[deleteCategory]', err)
    toast.add({ title: 'Failed to delete category', color: 'error', duration: 4000 })
  } finally {
    confirmDeleteCategory.value = null
  }
}

async function saveActivity() {
  if (saving.value) return
  const validationError = validateActivityTitle(actForm.title)
  if (validationError) {
    activityTitleError.value = validationError
    return
  }
  activityTitleError.value = null
  const payload = buildActivityPayload(actForm, activityCategoryId.value)
  saving.value = true
  try {
    if (editingActivity.value) {
      await db.updateBoredActivity({ id: editingActivity.value.id, ...payload })
    } else {
      await db.createBoredActivity(payload)
    }
    showActivityModal.value = false
    await load()
  } catch (err) {
    logError('[saveActivity]', err)
    toast.add({ title: 'Failed to save activity', color: 'error', duration: 4000 })
  } finally {
    saving.value = false
  }
}

async function deleteActivity(a: BoredActivity) {
  try {
    await db.deleteBoredActivity(a.id)
    await load()
    toast.add({ title: 'Activity deleted', color: 'success', duration: 2000 })
  } catch (err) {
    logError('[deleteActivity]', err)
    toast.add({ title: 'Failed to delete activity', color: 'error', duration: 4000 })
  } finally {
    confirmDeleteActivity.value = null
  }
}

const confirmArchiveActivity = ref<BoredActivity | null>(null)

async function archiveActivity(a: BoredActivity) {
  try {
    await db.archiveBoredActivity(a.id)
    await load()
    toast.add({ title: 'Activity archived', color: 'success', duration: 2000 })
  } catch (err) {
    logError('[archiveActivity]', err)
    toast.add({ title: 'Failed to archive activity', color: 'error', duration: 4000 })
  } finally {
    confirmArchiveActivity.value = null
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto space-y-6">
    <BackNav to="/bored" label="Manage Activities" title />

    <!-- Category sections -->
    <div v-for="cat in categories" :key="cat.id" class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <AppIcon :name="cat.icon" class="w-4 h-4" :color="cat.color" />
          <span class="font-semibold text-sm">{{ cat.name }}</span>
          <span class="text-xs text-(--ui-text-dimmed)">({{ activitiesForCategory(cat.id).length }})</span>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            v-if="!cat.is_system"
            variant="ghost"
            color="neutral"
            size="sm"
            :icon="resolveIcon('pencil')"
            :aria-label="`Edit ${cat.name} category`"
            class="min-h-[44px] min-w-[44px]"
            @click="openEditCategory(cat)"
          />
          <UButton
            v-if="!cat.is_system"
            variant="ghost"
            color="error"
            size="sm"
            :icon="resolveIcon('trash')"
            :aria-label="`Delete ${cat.name} category`"
            class="min-h-[44px] min-w-[44px]"
            @click="confirmDeleteCategory = cat"
          />
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            :icon="resolveIcon('plus')"
            :aria-label="`Add activity to ${cat.name}`"
            class="min-h-[44px] min-w-[44px]"
            @click="openAddActivity(cat.id)"
          />
        </div>
      </div>

      <div class="space-y-1">
        <div
          v-for="act in activitiesForCategory(cat.id)"
          :key="act.id"
          class="flex items-center justify-between bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl px-4 py-3"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" :class="act.is_done ? 'line-through text-(--ui-text-dimmed)' : ''">
              {{ act.title }}
            </p>
            <div class="flex items-center gap-2 mt-0.5">
              <span v-if="act.estimated_minutes" class="text-xs text-(--ui-text-dimmed)">
                {{ act.estimated_minutes }}m
              </span>
              <span v-if="act.is_recurring" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5">
                <AppIcon name="arrow-path" class="w-3 h-3" />
                {{ act.recurrence_rule }}
              </span>
              <span v-if="act.done_count > 0" class="text-xs text-(--ui-text-dimmed)">
                ×{{ act.done_count }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 ml-2 shrink-0">
            <UButton variant="ghost" color="neutral" size="sm" :icon="resolveIcon('pencil')" :aria-label="`Edit ${act.title}`" class="min-h-[44px] min-w-[44px]" @click="openEditActivity(act)" />
            <UButton variant="ghost" color="neutral" size="sm" :icon="resolveIcon('archive-box')" :aria-label="`Archive ${act.title}`" class="min-h-[44px] min-w-[44px]" @click="confirmArchiveActivity = act" />
            <UButton variant="ghost" color="error" size="sm" :icon="resolveIcon('trash')" :aria-label="`Delete ${act.title}`" class="min-h-[44px] min-w-[44px]" @click="confirmDeleteActivity = act" />
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
      :icon="resolveIcon('plus')"
      class="w-full"
      @click="openAddCategory"
    >
      Add custom category
    </UButton>

    <!-- Category modal -->
    <AppModal v-model="showCategoryModal">
        <h2 class="text-lg font-semibold">{{ editingCategory ? 'Edit Category' : 'New Category' }}</h2>
        <div class="space-y-3">
          <UFormField label="Name" required>
            <AppTextField v-model="catForm.name" placeholder="Category name" class="w-full" />
          </UFormField>
          <p v-if="categoryNameError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
            <AppIcon name="exclamation-circle" class="w-3.5 h-3.5 flex-shrink-0" />
            {{ categoryNameError }}
          </p>
          <UFormField label="Icon">
            <AppTextField v-model="catForm.icon" placeholder="sparkles" class="w-full" />
          </UFormField>
          <UFormField label="Color">
            <div class="flex items-center gap-2">
              <input v-model="catForm.color" type="color" class="w-10 h-8 rounded border border-(--ui-border-accented) bg-transparent cursor-pointer" />
              <AppTextField v-model="catForm.color" placeholder="#6366f1" class="flex-1" />
            </div>
          </UFormField>
        </div>
        <div class="flex gap-2 pt-1">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showCategoryModal = false">Cancel</UButton>
          <UButton color="primary" class="flex-1" :loading="saving" @click="saveCategory">Save</UButton>
        </div>
        <div class="safe-area-bottom" aria-hidden="true" />
    </AppModal>

    <!-- Activity modal -->
    <AppModal v-model="showActivityModal">
        <h2 class="text-lg font-semibold">{{ editingActivity ? 'Edit Activity' : 'New Activity' }}</h2>
        <div class="space-y-3">
          <UFormField label="Title" required>
            <AppTextField v-model="actForm.title" placeholder="Activity title" class="w-full" />
          </UFormField>
          <p v-if="activityTitleError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
            <AppIcon name="exclamation-circle" class="w-3.5 h-3.5 flex-shrink-0" />
            {{ activityTitleError }}
          </p>
          <UFormField label="Description">
            <AppTextArea v-model="actForm.description" placeholder="Optional description" class="w-full" />
          </UFormField>
          <UFormField label="Estimated minutes">
            <AppTextField v-model="actForm.estimated_minutes" type="number" min="1" placeholder="e.g. 20" class="w-full" />
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
                  :class="actForm.recurrence_rule === rule ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
                  @click="actForm.recurrence_rule = rule"
                >
                  {{ rule }}
                </button>
              </div>
            </UFormField>
          </div>
          <UFormField label="Tags">
            <TagInput v-model="actForm.tags" :suggest="suggestBoredTags" />
          </UFormField>
        </div>
        <div class="flex gap-2 pt-1">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showActivityModal = false">Cancel</UButton>
          <UButton color="primary" class="flex-1" :loading="saving" @click="saveActivity">Save</UButton>
        </div>
        <div class="safe-area-bottom" aria-hidden="true" />
    </AppModal>

    <!-- Delete activity confirm -->
    <ConfirmDialog
      :open="!!confirmDeleteActivity"
      icon="trash"
      icon-color="red"
      :title="`Delete &quot;${confirmDeleteActivity?.title}&quot;?`"
      message="This cannot be undone."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="confirmDeleteActivity && deleteActivity(confirmDeleteActivity)"
      @cancel="confirmDeleteActivity = null"
      @update:open="(open) => !open && (confirmDeleteActivity = null)"
    />

    <!-- Delete category confirm -->
    <ConfirmDialog
      :open="!!confirmDeleteCategory"
      icon="trash"
      icon-color="red"
      :title="`Delete &quot;${confirmDeleteCategory?.name}&quot;?`"
      message="All activities in this category will also be deleted."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="confirmDeleteCategory && deleteCategory(confirmDeleteCategory)"
      @cancel="confirmDeleteCategory = null"
      @update:open="(open) => !open && (confirmDeleteCategory = null)"
    />

    <!-- Archive activity confirm -->
    <ConfirmDialog
      :open="!!confirmArchiveActivity"
      icon="archive-box"
      icon-color="amber"
      :title="`Archive &quot;${confirmArchiveActivity?.title}&quot;?`"
      message="Archived activities won't appear in the oracle."
      confirm-label="Archive"
      confirm-color="warning"
      @confirm="confirmArchiveActivity && archiveActivity(confirmArchiveActivity)"
      @cancel="confirmArchiveActivity = null"
      @update:open="(open) => !open && (confirmArchiveActivity = null)"
    />
  </div>
</template>
