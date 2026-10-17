import { getDatabaseSyncInfo, syncDatabaseNow } from '~/plugins/database.client'

export function useSyncStatus() {
  const info = ref<Awaited<ReturnType<typeof getDatabaseSyncInfo>> | null>(null)
  const syncing = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  async function refresh() {
    info.value = await getDatabaseSyncInfo()
  }
  onMounted(() => {
    void refresh().catch((error) => logError('sync-status', error))
    timer = setInterval(() => {
      void refresh().catch((error) => logError('sync-status', error))
    }, 2_000)
  })
  onScopeDispose(() => {
    if (timer) clearInterval(timer)
  })
  const label = computed(() => {
    if (!info.value?.enabled) return 'Saved on this device'
    switch (info.value.status) {
      case 'caught_up':
        return 'Up to date'
      case 'offline':
        return 'Offline — changes are saved on this device'
      case 'blocked_auth':
        return 'Sign-in required to sync'
      case 'degraded':
        return 'Sync needs attention — changes are saved on this device'
      default:
        return 'Syncing…'
    }
  })
  async function syncNow() {
    syncing.value = true
    try {
      await syncDatabaseNow()
      await refresh()
    } catch (error) {
      logError('sync-now', error)
    } finally {
      syncing.value = false
    }
  }
  return { info, label, syncing, syncNow }
}
