<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { DashboardData } from '~/types/database'
import { contactDisplayName, contactInitials } from '~/utils/contact-helpers'
import { formatDate, formatDateRelative, formatRelativeTime, localDateString } from '~/utils/format'
import { interactionIcon, interactionSummary } from '~/utils/interaction-helpers'

const db = useDatabase()
const { activeVaultId } = useVault()

const today = localDateString(new Date())
const dashboard = ref<DashboardData | null>(null)
const loading = ref(true)

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    dashboard.value = await db.getDashboard(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(activeVaultId, load)

const isEmpty = computed(() =>
  dashboard.value &&
  dashboard.value.upcoming_dates.length === 0 &&
  dashboard.value.upcoming_birthdays.length === 0 &&
  dashboard.value.overdue_stay_in_touch.length === 0 &&
  dashboard.value.recent_interactions.length === 0,
)
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-zinc-100">Home</h1>
        <p class="text-sm text-zinc-500 mt-0.5">{{ formatDate(today) }}</p>
      </div>
      <UButton to="/contacts/new" icon="i-heroicons-plus" color="violet" variant="soft" size="sm">
        Add contact
      </UButton>
    </header>

    <div v-if="loading" class="space-y-4">
      <USkeleton v-for="i in 3" :key="i" class="h-16 rounded-xl" />
    </div>

    <template v-else-if="dashboard">
      <!-- Reach out / stay-in-touch overdue -->
      <section v-if="dashboard.overdue_stay_in_touch.length > 0">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
          <UIcon name="i-heroicons-hand-raised" class="size-3.5" />
          Reach out
          <span class="ml-auto bg-red-500/20 text-red-400 text-xs rounded-full px-2 py-0.5">
            {{ dashboard.overdue_stay_in_touch.length }}
          </span>
        </h2>
        <ul class="space-y-2">
          <li
            v-for="sit in dashboard.overdue_stay_in_touch"
            :key="sit.id"
            class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3"
          >
            <div
              class="size-9 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 font-medium text-sm shrink-0"
            >
              {{ contactInitials(sit.contact) }}
            </div>
            <div class="min-w-0 flex-1">
              <NuxtLink
                :to="`/contacts/${sit.contact.id}`"
                class="font-medium text-zinc-100 hover:text-violet-400 truncate block"
              >
                {{ contactDisplayName(sit.contact) }}
              </NuxtLink>
              <p class="text-xs text-red-400">
                {{ sit.last_contacted_at ? `Last contact ${formatRelativeTime(sit.last_contacted_at)}` : 'Never contacted' }}
              </p>
            </div>
            <UButton
              size="xs"
              variant="soft"
              color="violet"
              :to="`/contacts/${sit.contact.id}/interactions/new`"
            >
              Log
            </UButton>
          </li>
        </ul>
      </section>

      <!-- Upcoming birthdays -->
      <section v-if="dashboard.upcoming_birthdays.length > 0">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
          <UIcon name="i-heroicons-cake" class="size-3.5" />
          Birthdays
        </h2>
        <ul class="space-y-2">
          <li
            v-for="item in dashboard.upcoming_birthdays"
            :key="item.contact.id"
            class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3"
          >
            <div
              class="size-9 rounded-full flex items-center justify-center shrink-0"
              :class="item.days_away === 0 ? 'bg-violet-600 text-white' : 'bg-violet-900/50 text-violet-300'"
            >
              <UIcon name="i-heroicons-cake" class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <NuxtLink
                :to="`/contacts/${item.contact.id}`"
                class="font-medium text-zinc-100 hover:text-violet-400 truncate block"
              >
                {{ contactDisplayName(item.contact) }}
              </NuxtLink>
              <p class="text-xs text-zinc-500">
                <span :class="item.days_away === 0 ? 'text-violet-400 font-semibold' : ''">
                  {{ item.days_away === 0 ? 'Today!' : item.days_away === 1 ? 'Tomorrow' : `In ${item.days_away} days` }}
                </span>
                <span v-if="item.turning_age"> · Turning {{ item.turning_age }}</span>
              </p>
            </div>
          </li>
        </ul>
      </section>

      <!-- Upcoming dates (reminders) -->
      <section v-if="dashboard.upcoming_dates.length > 0">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
          <UIcon name="i-heroicons-calendar" class="size-3.5" />
          Upcoming
        </h2>
        <ul class="space-y-2">
          <li
            v-for="item in dashboard.upcoming_dates"
            :key="item.reminder.id"
            class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3"
          >
            <div class="size-9 rounded-full bg-violet-900/50 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-bell" class="size-4 text-violet-400" />
            </div>
            <div class="min-w-0 flex-1">
              <NuxtLink
                :to="`/contacts/${item.contact.id}`"
                class="font-medium text-zinc-100 hover:text-violet-400 truncate block"
              >
                {{ item.reminder.title }}
              </NuxtLink>
              <p class="text-xs text-zinc-500">
                {{ contactDisplayName(item.contact) }} ·
                <span :class="item.days_away === 0 ? 'text-violet-400 font-medium' : 'text-zinc-400'">
                  {{ item.days_away === 0 ? 'Today' : `in ${item.days_away}d` }}
                </span>
              </p>
            </div>
          </li>
        </ul>
      </section>

      <!-- Recent interactions -->
      <section v-if="dashboard.recent_interactions.length > 0">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
          <UIcon name="i-heroicons-clock" class="size-3.5" />
          Recent
        </h2>
        <ul class="space-y-2">
          <li
            v-for="interaction in dashboard.recent_interactions"
            :key="interaction.id"
            class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3"
          >
            <div class="size-9 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <UIcon :name="interactionIcon(interaction.type)" class="size-4 text-zinc-400" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-zinc-100 truncate">{{ interactionSummary(interaction) }}</p>
              <p class="text-xs text-zinc-500">
                {{ interaction.contacts.map(contactDisplayName).join(', ') }} ·
                {{ formatRelativeTime(interaction.happened_at) }}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <!-- Empty state -->
      <div v-if="isEmpty" class="text-center py-16 space-y-4">
        <div class="size-16 rounded-full bg-violet-900/30 flex items-center justify-center mx-auto">
          <UIcon name="i-heroicons-users" class="size-8 text-violet-400" />
        </div>
        <div>
          <p class="text-zinc-300 font-medium">Your relationship manager is ready</p>
          <p class="text-zinc-500 text-sm mt-1">Add contacts to see reminders, birthdays, and stay in touch.</p>
        </div>
        <UButton to="/contacts/new" color="violet" variant="soft" icon="i-heroicons-plus">
          Add your first contact
        </UButton>
      </div>
    </template>

    <!-- No vault yet -->
    <div v-else-if="!activeVaultId && !loading" class="text-center py-16 space-y-4">
      <p class="text-zinc-500">Set up a vault to get started.</p>
      <UButton to="/settings/vault" color="violet" variant="soft">Open settings</UButton>
    </div>
  </div>
</template>
