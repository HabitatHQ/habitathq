<script setup lang="ts">
import { logError } from '~/utils/error'

const { settings } = useAppSettings()
const db = useDatabase()
const dbError = useState<string | null>('db-error', () => null)
const { ensureSeeded } = useSeed()
const { load: loadExercises } = useExercises()
const offline = ref(false)
const seedError = ref<string | null>(null)

function refresh() {
  window.location.reload()
}

onMounted(() => {
  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.value.theme)
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion)
  })
  const updateNetwork = () => {
    offline.value = !navigator.onLine
  }
  updateNetwork()
  window.addEventListener('online', updateNetwork)
  window.addEventListener('offline', updateNetwork)
  onUnmounted(() => {
    window.removeEventListener('online', updateNetwork)
    window.removeEventListener('offline', updateNetwork)
  })
  watch(
    db.status,
    async (status) => {
      if (status !== 'ready' || dbError.value) return
      try {
        await ensureSeeded()
        await loadExercises()
      } catch (error) {
        logError('seed', error)
        seedError.value =
          'Exercise library could not be loaded. Your saved workouts have not been reset.'
      }
    },
    { immediate: true },
  )
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <section v-if="dbError || seedError" role="alert" class="m-4 rounded-xl border border-(--ui-border) bg-(--color-surface) p-5 space-y-3">
        <h1 class="text-xl font-bold">Unable to open your training log</h1>
        <p>{{ dbError || seedError }}</p>
        <p class="text-sm text-(--ui-text-muted)">If another tab is open, close it before retrying. Your local data stays on this device.</p>
        <UButton @click="refresh">Retry opening log</UButton>
      </section>
      <template v-else>
        <p v-if="offline" role="status" class="px-4 py-2 text-sm bg-(--color-surface)">Offline · workouts are saved on this device</p>
        <NuxtPage />
      </template>
    </NuxtLayout>
  </UApp>
</template>
