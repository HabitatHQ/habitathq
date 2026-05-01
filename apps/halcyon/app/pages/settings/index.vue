<script setup lang="ts">
const links = [
  { label: 'Vaults', description: 'Manage your vaults', to: '/settings/vault', icon: 'i-heroicons-archive-box' },
  { label: 'Contact field types', description: 'Custom fields for contacts', to: '/settings/field-types', icon: 'i-heroicons-tag' },
  { label: 'Relationship types', description: 'Define relationship labels', to: '/settings/relationship-types', icon: 'i-heroicons-arrow-path-rounded-square' },
  { label: 'Import & Export', description: 'Import vCard, export JSON or vCard', to: '/settings/import-export', icon: 'i-heroicons-arrow-down-tray' },
]
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="px-4 pt-6 pb-4">
      <h1 class="font-semibold text-zinc-100 text-lg">Settings</h1>
    </div>

    <div class="px-4 space-y-2">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 hover:bg-zinc-800 transition-colors"
      >
        <UIcon :name="link.icon" class="size-5 text-zinc-400 shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="font-medium text-zinc-100">{{ link.label }}</p>
          <p class="text-sm text-zinc-500">{{ link.description }}</p>
        </div>
        <UIcon name="i-heroicons-chevron-right" class="size-4 text-zinc-600" />
      </NuxtLink>
    </div>
  </div>
</template>
