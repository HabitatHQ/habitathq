<script setup lang="ts">
import { toRaw } from 'vue'
import { parseBackupSettingsFromEnvelope } from '~/lib/data-transfer'

const { settings, set, replace: replaceSettings } = useAppSettings()

const themes = [
  { label: 'Hephaestus', value: 'hephaestus' as const, desc: 'Dark · Orange flame' },
  { label: 'Forge', value: 'forge' as const, desc: 'Dark · Steel blue' },
  { label: 'Daylight', value: 'daylight' as const, desc: 'Light · Warm orange' },
]

const restOptions = [60, 90, 120, 150, 180, 240, 300]

function updateRamp(i: number, e: Event) {
  const val = Number.parseInt((e.target as HTMLInputElement).value, 10)
  if (!Number.isNaN(val) && val > 0 && val < 100) {
    const ramps = [...settings.value.warmupRamps]
    ramps[i] = val
    set('warmupRamps', ramps)
  }
}
const db = useDatabase()
const statusMessage = ref('')
const errorMessage = ref('')
const pendingBackup = ref<unknown>(null)
type BackupPreview = {
  valid: boolean
  rowCount?: number
  workoutCount?: number
  templateCount?: number
  programCount?: number
  error?: string
}
const backupPreview = ref<BackupPreview | null>(null)
const pendingPortable = ref<unknown>(null)
type PortablePreview = {
  valid: boolean
  templateCount?: number
  programCount?: number
  rowCount?: number
  error?: string
}
const portablePreview = ref<PortablePreview | null>(null)
const resetPreferences = ref(false)

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

async function exportBackup() {
  errorMessage.value = ''
  try {
    const backup = await db.transfer<unknown>('TRANSFER_EXPORT_BACKUP', {
      settings: { ...settings.value, warmupRamps: [...settings.value.warmupRamps] },
    })
    download(
      'hephaestus-backup.json',
      JSON.stringify(backup, null, 2),
      'application/json;charset=utf-8',
    )
    statusMessage.value = 'Backup downloaded.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function inspectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''
  try {
    pendingBackup.value = JSON.parse(await file.text())
    const preview = await db.transfer<BackupPreview>('TRANSFER_PREVIEW_RESTORE', {
      backup: toRaw(pendingBackup.value),
    })
    backupPreview.value = preview
    if (!preview.valid) errorMessage.value = preview.error ?? 'Backup is invalid.'
  } catch (error) {
    pendingBackup.value = null
    backupPreview.value = null
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

async function restoreBackup() {
  if (!pendingBackup.value || !backupPreview.value?.valid) return
  if (
    !window.confirm(
      'Replace all Hephaestus database data and app settings with this backup? This cannot be undone.',
    )
  )
    return
  errorMessage.value = ''
  statusMessage.value = ''

  let restoredSettings: ReturnType<typeof parseBackupSettingsFromEnvelope>
  let previousSettingsJson: string | null
  try {
    restoredSettings = parseBackupSettingsFromEnvelope(toRaw(pendingBackup.value))
    const nextSettingsJson = JSON.stringify(restoredSettings)
    previousSettingsJson = localStorage.getItem('hephaestus-app-settings')
    localStorage.setItem('hephaestus-app-settings', nextSettingsJson)
  } catch (error) {
    errorMessage.value = `Backup was not restored; existing data and preferences are unchanged. App preferences could not be staged: ${error instanceof Error ? error.message : String(error)}`
    return
  }

  try {
    await db.transfer('TRANSFER_RESTORE_BACKUP', { backup: toRaw(pendingBackup.value) })
  } catch (restoreError) {
    try {
      if (previousSettingsJson === null) localStorage.removeItem('hephaestus-app-settings')
      else localStorage.setItem('hephaestus-app-settings', previousSettingsJson)
    } catch (rollbackError) {
      errorMessage.value = `Backup database restore failed; database data is unchanged, but app preference storage could not be restored and may be inconsistent. Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)} Preference rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      return
    }
    errorMessage.value = `Backup was not restored; database data and app preferences are unchanged. ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
    return
  }

  replaceSettings(restoredSettings, false)
  pendingBackup.value = null
  backupPreview.value = null
  statusMessage.value = 'Backup restored. Reload Hephaestus to refresh all screens.'
}

async function exportPortable() {
  errorMessage.value = ''
  try {
    const bundle = await db.transfer<unknown>('TRANSFER_EXPORT_PORTABLE')
    download(
      'hephaestus-training-portable.json',
      JSON.stringify(bundle, null, 2),
      'application/json;charset=utf-8',
    )
    statusMessage.value = 'Templates and programs downloaded.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function inspectPortable(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''
  try {
    pendingPortable.value = JSON.parse(await file.text())
    const preview = await db.transfer<PortablePreview>('TRANSFER_PREVIEW_PORTABLE_IMPORT', {
      bundle: toRaw(pendingPortable.value),
    })
    portablePreview.value = preview
    if (!preview.valid) errorMessage.value = preview.error ?? 'Portable file is invalid.'
  } catch (error) {
    pendingPortable.value = null
    portablePreview.value = null
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

async function importPortable() {
  if (!pendingPortable.value || !portablePreview.value?.valid) return
  if (
    !window.confirm(
      'Import these templates and programs? Existing content will not be overwritten.',
    )
  )
    return
  errorMessage.value = ''
  try {
    await db.transfer('TRANSFER_IMPORT_PORTABLE', { bundle: toRaw(pendingPortable.value) })
    pendingPortable.value = null
    portablePreview.value = null
    statusMessage.value = 'Templates and programs imported.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function exportCsv() {
  errorMessage.value = ''
  try {
    const csv = await db.transfer<string>('TRANSFER_EXPORT_WORKOUT_CSV')
    download('hephaestus-workout-history.csv', `\uFEFF${csv}`, 'text/csv;charset=utf-8')
    statusMessage.value = 'Workout history CSV downloaded.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function resetData() {
  if (
    !window.confirm(
      'Clear all Hephaestus application database records? This cannot be undone. App preferences are kept unless you separately confirm their reset.',
    )
  )
    return
  if (
    resetPreferences.value &&
    !window.confirm('Also reset Hephaestus app preferences stored under hephaestus-app-settings?')
  )
    return
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await db.clearLocalData()
  } catch (error) {
    errorMessage.value = `Hephaestus database reset failed; app preferences were not changed. ${error instanceof Error ? error.message : String(error)}`
    return
  }
  statusMessage.value =
    'Hephaestus application database cleared. Reload the app to initialize an empty database.'
  if (resetPreferences.value) {
    try {
      localStorage.removeItem('hephaestus-app-settings')
    } catch (error) {
      errorMessage.value = `The database was cleared, but app preferences could not be reset. ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
</script>

<template>
  <article class="p-4 space-y-6">
    <h1 class="text-2xl font-bold pt-2">Profile</h1>

    <!-- Theme -->
    <section aria-labelledby="theme-heading">
      <h2
        id="theme-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Theme
      </h2>
      <ul role="list" class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <li v-for="theme in themes" :key="theme.value">
          <button
            class="flex items-center w-full px-4 py-3 text-sm gap-3"
            :aria-pressed="settings.theme === theme.value"
            @click="set('theme', theme.value)"
          >
            <div class="flex-1 text-left">
              <p class="font-medium">{{ theme.label }}</p>
              <p class="text-xs text-(--ui-text-muted)">{{ theme.desc }}</p>
            </div>
            <UIcon
              v-if="settings.theme === theme.value"
              name="i-heroicons-check"
              class="w-4 h-4 text-(--color-accent)"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </section>

    <!-- Units -->
    <section aria-labelledby="units-heading">
      <h2
        id="units-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Units
      </h2>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">Weight</p>
          <div class="flex gap-2" role="group" aria-label="Weight units">
            <button
              v-for="u in (['kg', 'lbs'] as const)"
              :key="u"
              class="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              :class="
                settings.weightUnit === u
                  ? 'bg-(--color-accent) text-(--color-on-accent)'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              :aria-pressed="settings.weightUnit === u"
              @click="set('weightUnit', u)"
            >
              {{ u }}
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">Distance</p>
          <div class="flex gap-2" role="group" aria-label="Distance units">
            <button
              v-for="u in (['km', 'mi'] as const)"
              :key="u"
              class="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              :class="
                settings.distanceUnit === u
                  ? 'bg-(--color-accent) text-(--color-on-accent)'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              :aria-pressed="settings.distanceUnit === u"
              @click="set('distanceUnit', u)"
            >
              {{ u }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Workout defaults -->
    <section aria-labelledby="defaults-heading">
      <h2
        id="defaults-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Workout Defaults
      </h2>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm">Default rest timer</p>
            <div class="text-sm font-medium text-(--color-accent)">{{ settings.defaultRestSeconds }}s</div>
          </div>
          <div class="flex gap-2 flex-wrap" role="group" aria-label="Rest timer options">
            <button
              v-for="secs in restOptions"
              :key="secs"
              class="px-2.5 py-1 text-xs rounded-full transition-colors"
              :class="
                settings.defaultRestSeconds === secs
                  ? 'bg-(--color-accent) text-(--color-on-accent)'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              @click="set('defaultRestSeconds', secs)"
            >
              {{ secs }}s
            </button>
          </div>
        </div>
        <!-- Warm-up ramps -->
        <div class="px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm">Warm-up ramps</p>
            <div class="text-xs text-(--ui-text-muted)">% of working weight</div>
          </div>
          <div class="flex gap-2">
            <input
              v-for="(ramp, i) in settings.warmupRamps"
              :key="i"
              type="number"
              min="10"
              max="95"
              step="5"
              :value="ramp"
              class="w-16 text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
              :aria-label="`Ramp ${i + 1} percentage`"
              @change="updateRamp(i, $event)"
            />
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">Show RPE field</p>
          <div>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.showRpe ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"

              role="switch"
              :aria-checked="settings.showRpe"
              aria-label="Show RPE field"
              @click="set('showRpe', !settings.showRpe)"
            >
              <span
                class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                :class="settings.showRpe ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">Show RIR field</p>
          <div>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.showRir ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"

              role="switch"
              :aria-checked="settings.showRir"
              aria-label="Show RIR field"
              @click="set('showRir', !settings.showRir)"
            >
              <span
                class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                :class="settings.showRir ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section aria-labelledby="features-heading">
      <h2
        id="features-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Features
      </h2>

      <!-- While working out -->
      <p class="text-xs text-(--ui-text-muted) mb-1.5 px-1">While working out</p>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border) mb-3">
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Warm-up suggestions</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Ramp calculator button in the add-set sheet</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showWarmupSuggestions ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showWarmupSuggestions"
            aria-label="Warm-up suggestions"
            @click="set('showWarmupSuggestions', !settings.showWarmupSuggestions)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showWarmupSuggestions ? 'translate-x-4' : ''"
            />
          </button>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Failure rest prompt</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Toast after logging a failure — "Take extra rest?"</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showFailurePrompt ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showFailurePrompt"
            aria-label="Failure rest prompt"
            @click="set('showFailurePrompt', !settings.showFailurePrompt)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showFailurePrompt ? 'translate-x-4' : ''"
            />
          </button>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Session notes</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Notes field on the finish-workout sheet</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showSessionNotes ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showSessionNotes"
            aria-label="Session notes"
            @click="set('showSessionNotes', !settings.showSessionNotes)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showSessionNotes ? 'translate-x-4' : ''"
            />
          </button>
        </div>
      </div>

      <!-- Template builder -->
      <p class="text-xs text-(--ui-text-muted) mb-1.5 px-1">Template builder</p>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Superset groups</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Assign exercises to supersets, circuits, or giant sets</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showSupersets ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showSupersets"
            aria-label="Superset groups"
            @click="set('showSupersets', !settings.showSupersets)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showSupersets ? 'translate-x-4' : ''"
            />
          </button>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Set schemes</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Pyramid, drop sets, rest-pause progressions</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showSetSchemes ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showSetSchemes"
            aria-label="Set schemes"
            @click="set('showSetSchemes', !settings.showSetSchemes)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showSetSchemes ? 'translate-x-4' : ''"
            />
          </button>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm">Variable rest per set</p>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">Override rest time individually for each set</p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors shrink-0 ml-4"
            :class="settings.showVariableRest ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
            role="switch"
            :aria-checked="settings.showVariableRest"
            aria-label="Variable rest per set"
            @click="set('showVariableRest', !settings.showVariableRest)"
          >
            <span
              class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
              :class="settings.showVariableRest ? 'translate-x-4' : ''"
            />
          </button>
        </div>
      </div>
    </section>

    <section aria-labelledby="data-heading" class="space-y-3">
      <h2 id="data-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
        Data portability
      </h2>
      <p class="text-xs text-(--ui-text-muted)">
        Backups include all supported durable database tables and app preferences; temporary runtime state is excluded.
        Workout history CSV uses local calendar dates, stored kg values, null marker \N, and quoted empty strings.
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton color="primary" icon="i-ph-download-simple" @click="exportBackup">Download full backup</UButton>
        <UButton color="neutral" icon="i-ph-download-simple" @click="exportCsv">Download workout CSV</UButton>
        <UButton color="neutral" icon="i-ph-download-simple" @click="exportPortable">Export templates and programs</UButton>
      </div>
      <label class="block text-sm">
        <span class="sr-only">Choose a Hephaestus backup JSON file</span>
        <input type="file" accept="application/json,.json" aria-label="Choose backup file" @change="inspectBackup">
      </label>
      <div v-if="backupPreview" class="rounded-lg bg-(--color-surface) p-3 text-sm" aria-live="polite">
        <p v-if="backupPreview.valid">
          Preview: {{ backupPreview.rowCount }} rows, {{ backupPreview.workoutCount }} workouts,
          {{ backupPreview.templateCount }} templates, {{ backupPreview.programCount }} programs.
        </p>
        <UButton v-if="backupPreview.valid" class="mt-2 text-(--color-danger)" color="error" variant="outline" @click="restoreBackup">
          Replace local data from backup
        </UButton>
      </div>
      <label class="block text-sm">
        <span>Import templates and programs from JSON</span>
        <input class="mt-1 block" type="file" accept="application/json,.json" aria-label="Choose templates and programs file" @change="inspectPortable">
      </label>
      <div v-if="portablePreview" class="rounded-lg bg-(--color-surface) p-3 text-sm" aria-live="polite">
        <p v-if="portablePreview.valid">
          Preview: {{ portablePreview.templateCount }} templates and {{ portablePreview.programCount }} programs.
        </p>
        <UButton v-if="portablePreview.valid" class="mt-2" color="primary" @click="importPortable">Import without overwriting</UButton>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="resetPreferences" type="checkbox">
        Also reset Hephaestus app preferences (hephaestus-app-settings only)
      </label>
      <UButton class="text-(--color-danger)" color="error" variant="outline" icon="i-ph-trash" @click="resetData">
        Reset Hephaestus database
      </UButton>
      <p v-if="statusMessage" role="status" aria-live="polite" class="text-sm text-green-400">{{ statusMessage }}</p>
      <p v-if="errorMessage" role="alert" class="text-sm text-red-400">{{ errorMessage }}</p>
    </section>
    <!-- Accessibility -->
    <section aria-labelledby="a11y-heading">
      <h2
        id="a11y-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Accessibility
      </h2>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">Reduce motion</p>
          <div>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.reduceMotion ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
              role="switch"
              :aria-checked="settings.reduceMotion"
              aria-label="Reduce motion"
              @click="set('reduceMotion', !settings.reduceMotion)"
            >
              <span
                class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                :class="settings.reduceMotion ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm">24-hour time</p>
          <div>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.use24HourTime ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
              role="switch"
              :aria-checked="settings.use24HourTime"
              aria-label="Use 24-hour time"
              @click="set('use24HourTime', !settings.use24HourTime)"
            >
              <span
                class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                :class="settings.use24HourTime ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  </article>
</template>
