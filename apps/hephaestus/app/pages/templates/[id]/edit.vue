<script setup lang="ts">
import type { TemplateRow } from '~/types/database'

const route = useRoute()
const { getById, update } = useTemplates()
const db = useDatabase()

const templateId = computed(() => route.params.id as string)

const template = ref<TemplateRow | null>(null)
const loading = ref(true)
const saving = ref(false)

const name = ref('')
const description = ref('')
const coverEmoji = ref('')

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    try {
      template.value = await getById(templateId.value)
      if (template.value) {
        name.value = template.value.name
        description.value = template.value.description ?? ''
        coverEmoji.value = template.value.cover_emoji ?? ''
      }
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const canSave = computed(() => name.value.trim().length > 0)

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    await update(templateId.value, {
      name: name.value.trim(),
      description: description.value.trim() || null,
      cover_emoji: coverEmoji.value || null,
    })
    await navigateTo(`/templates/${templateId.value}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <article class="p-4 pb-24 space-y-5">
      <header class="flex items-center gap-3 pt-2">
        <NuxtLink :to="`/templates/${templateId}`" class="text-(--ui-text-muted)" aria-label="Back to template">
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
        </NuxtLink>
        <h1 class="text-xl font-bold flex-1">Edit Template</h1>
        <UButton
          size="sm"
          color="primary"
          :disabled="!canSave || saving"
          :loading="saving"
          @click="handleSave"
        >
          Save
        </UButton>
      </header>

      <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
        <p>Loading…</p>
      </div>

      <template v-else-if="template">
        <!-- Cover emoji -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="tpl-emoji">
            Cover Emoji <span class="normal-case font-normal">(optional)</span>
          </label>
          <input
            id="tpl-emoji"
            v-model="coverEmoji"
            type="text"
            placeholder="💪"
            maxlength="2"
            class="w-20 bg-(--color-surface) rounded-xl px-3 py-2.5 text-2xl text-center outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          />
        </div>

        <!-- Name -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="tpl-name">
            Name
          </label>
          <input
            id="tpl-name"
            v-model="name"
            type="text"
            placeholder="e.g. Push Day A"
            class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          />
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="tpl-desc">
            Description <span class="normal-case font-normal">(optional)</span>
          </label>
          <input
            id="tpl-desc"
            v-model="description"
            type="text"
            placeholder="Brief note about this template"
            class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          />
        </div>
      </template>

      <div v-else class="text-center py-12 text-(--ui-text-muted)">
        <p>Template not found.</p>
      </div>
    </article>
  </div>
</template>
