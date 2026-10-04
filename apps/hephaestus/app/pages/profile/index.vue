<script setup lang="ts">
import AppDestructiveConfirm from '@habitathq/shared/app/components/AppDestructiveConfirm.vue'
import AppFeatureToggle from '@habitathq/shared/app/components/AppFeatureToggle.vue'
import AppOperationFeedback from '@habitathq/shared/app/components/AppOperationFeedback.vue'
import { downloadBlob } from '@habitathq/shared/app/composables/downloadBlob'
import { useAsyncOperation } from '@habitathq/shared/app/composables/useAsyncOperation'
import { useDestructiveConfirmation } from '@habitathq/shared/app/composables/useDestructiveConfirmation'
import { useFeatureToggle } from '@habitathq/shared/app/composables/useFeatureToggle'
import { writeStoredSettings } from '@habitathq/utils'
import { toRaw } from 'vue'
import { parseBackupSettingsFromEnvelope, type RestorePreview } from '~/lib/data-transfer'

const { settings, set, replace: replaceSettings } = useAppSettings()
const db = useDatabase()
const themes = [
  { label: 'Hephaestus', value: 'hephaestus' as const, desc: 'Dark · Orange flame' },
  { label: 'Forge', value: 'forge' as const, desc: 'Dark · Steel blue' },
  { label: 'Daylight', value: 'daylight' as const, desc: 'Light · Warm orange' },
]
const restOptions = [60, 90, 120, 150, 180, 240, 300]
const statusMessage = ref('')
const errorMessage = ref('')
const pendingBackup = ref<unknown>(null)
const backupPreview = ref<RestorePreview | null>(null)
const pendingPortable = ref<unknown>(null)
const portablePreview = ref<RestorePreview | null>(null)
const resetPreferences = ref(false)
const operation = useAsyncOperation<[() => Promise<void>], void>({ action: (action) => action() })
const restoreConfirmation = useDestructiveConfirmation<[]>()
const importConfirmation = useDestructiveConfirmation<[]>()
const resetConfirmation = useDestructiveConfirmation<[]>()
const resetPreferencesConfirmation = useDestructiveConfirmation<[]>()

async function runOperation(action: () => Promise<void>) {
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await operation.run(action)
  } catch (error) {
    if (!errorMessage.value)
      errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function updateRamp(i: number, e: Event) {
  const val = Number.parseInt((e.target as HTMLInputElement).value, 10)
  if (!Number.isNaN(val) && val > 0 && val < 100) {
    const ramps = [...settings.value.warmupRamps]
    ramps[i] = val
    set('warmupRamps', ramps)
  }
}

async function exportBackup() {
  const backup = await db.transfer<unknown>('TRANSFER_EXPORT_BACKUP', {
    settings: { ...settings.value, warmupRamps: [...settings.value.warmupRamps] },
  })
  downloadBlob(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
    'hephaestus-backup.json',
  )
  statusMessage.value = 'Backup downloaded.'
}

async function inspectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''
  try {
    pendingBackup.value = JSON.parse(await file.text())
    const preview = await db.transfer<RestorePreview>('TRANSFER_PREVIEW_RESTORE', {
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
  let restoredSettings: ReturnType<typeof parseBackupSettingsFromEnvelope>
  let previousSettingsJson: string | null
  try {
    restoredSettings = parseBackupSettingsFromEnvelope(toRaw(pendingBackup.value))
    previousSettingsJson = localStorage.getItem('hephaestus-app-settings')
    writeStoredSettings('hephaestus-app-settings', restoredSettings)
  } catch (error) {
    errorMessage.value = `Backup was not restored; existing data and preferences are unchanged. App preferences could not be staged: ${error instanceof Error ? error.message : String(error)}`
    throw error
  }
  try {
    await db.transfer('TRANSFER_RESTORE_BACKUP', { backup: toRaw(pendingBackup.value) })
  } catch (restoreError) {
    try {
      if (previousSettingsJson === null) localStorage.removeItem('hephaestus-app-settings')
      else localStorage.setItem('hephaestus-app-settings', previousSettingsJson)
    } catch (rollbackError) {
      errorMessage.value = `Backup database restore failed; database data is unchanged, but app preference storage could not be restored and may be inconsistent. Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)} Preference rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      throw restoreError
    }
    errorMessage.value = `Backup was not restored; database data and app preferences are unchanged. ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
    throw restoreError
  }
  replaceSettings(restoredSettings, false)
  pendingBackup.value = null
  backupPreview.value = null
  window.location.reload()
  statusMessage.value = 'Backup restored. Reload Hephaestus to refresh all screens.'
}

async function exportPortable() {
  const bundle = await db.transfer<unknown>('TRANSFER_EXPORT_PORTABLE')
  downloadBlob(
    new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }),
    'hephaestus-training-portable.json',
  )
  statusMessage.value = 'Training configuration downloaded.'
}

async function inspectPortable(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''
  try {
    pendingPortable.value = JSON.parse(await file.text())
    const preview = await db.transfer<RestorePreview>('TRANSFER_PREVIEW_PORTABLE_IMPORT', {
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
  await db.transfer('TRANSFER_IMPORT_PORTABLE', { bundle: toRaw(pendingPortable.value) })
  pendingPortable.value = null
  portablePreview.value = null
  statusMessage.value = 'Training configuration imported.'
}

async function exportCsv() {
  const csv = await db.transfer<string>('TRANSFER_EXPORT_WORKOUT_CSV')
  downloadBlob(
    new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
    'hephaestus-workout-history.csv',
  )
  statusMessage.value = 'Workout history CSV downloaded.'
}

async function resetData() {
  try {
    await db.resetDatabase()
  } catch (error) {
    errorMessage.value = `Hephaestus database reset failed; app preferences were not changed. ${error instanceof Error ? error.message : String(error)}`
    throw error
  }
  statusMessage.value =
    'Hephaestus application database cleared. Reload the app to initialize an empty database.'
  if (resetPreferences.value) {
    try {
      localStorage.removeItem('hephaestus-app-settings')
    } catch (error) {
      errorMessage.value = `The database was cleared, but app preferences could not be reset. ${error instanceof Error ? error.message : String(error)}`
      throw error
    }
  }
  window.location.reload()
}

function confirmRestore() {
  restoreConfirmation.confirm()
  void runOperation(restoreBackup)
}

function confirmImport() {
  importConfirmation.confirm()
  void runOperation(importPortable)
}

function confirmReset() {
  resetConfirmation.confirm()
  if (resetPreferences.value) resetPreferencesConfirmation.request()
  else void runOperation(resetData)
}

function confirmResetPreferences() {
  resetPreferencesConfirmation.confirm()
  void runOperation(resetData)
}

function cancelResetPreferences() {
  resetPreferencesConfirmation.cancel()
}
async function updateToggle(setValue: (value: boolean) => Promise<void>, value: boolean) {
  operation.reset()
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await setValue(value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function useSettingsToggle(
  key:
    | 'showWarmupSuggestions'
    | 'showFailurePrompt'
    | 'showSessionNotes'
    | 'showSupersets'
    | 'showSetSchemes'
    | 'showVariableRest'
    | 'showRpe'
    | 'showRir'
    | 'reduceMotion'
    | 'use24HourTime',
) {
  return useFeatureToggle({
    key,
    value: computed(() => settings.value[key]),
    update: (feature, next) => set(feature, next),
  })
}
const warmupToggle = useSettingsToggle('showWarmupSuggestions')
const failureToggle = useSettingsToggle('showFailurePrompt')
const notesToggle = useSettingsToggle('showSessionNotes')
const supersetsToggle = useSettingsToggle('showSupersets')
const schemesToggle = useSettingsToggle('showSetSchemes')
const variableRestToggle = useSettingsToggle('showVariableRest')
const rpeToggle = useSettingsToggle('showRpe')
const rirToggle = useSettingsToggle('showRir')
const reduceMotionToggle = useSettingsToggle('reduceMotion')
const timeFormatToggle = useSettingsToggle('use24HourTime')
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
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="rpeToggle.value.value" :busy="rpeToggle.busy.value" label="Show RPE field" @update:model-value="value => updateToggle(rpeToggle.set, value)" />
        </div>
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="rirToggle.value.value" :busy="rirToggle.busy.value" label="Show RIR field" @update:model-value="value => updateToggle(rirToggle.set, value)" />
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
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="warmupToggle.value.value" :busy="warmupToggle.busy.value" label="Warm-up suggestions" description="Ramp calculator button in the add-set sheet" @update:model-value="value => updateToggle(warmupToggle.set, value)" />
        </div>
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="failureToggle.value.value" :busy="failureToggle.busy.value" label="Failure rest prompt" description="Toast after logging a failure — 'Take extra rest?'" @update:model-value="value => updateToggle(failureToggle.set, value)" />
        </div>
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="notesToggle.value.value" :busy="notesToggle.busy.value" label="Session notes" description="Notes field on the finish-workout sheet" @update:model-value="value => updateToggle(notesToggle.set, value)" />
        </div>
      </div>

      <!-- Template builder -->
      <p class="text-xs text-(--ui-text-muted) mb-1.5 px-1">Template builder</p>
      <div class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="supersetsToggle.value.value" :busy="supersetsToggle.busy.value" label="Superset groups" description="Assign exercises to supersets, circuits, or giant sets" @update:model-value="value => updateToggle(supersetsToggle.set, value)" />
        </div>
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="schemesToggle.value.value" :busy="schemesToggle.busy.value" label="Set schemes" description="Pyramid, drop sets, rest-pause progressions" @update:model-value="value => updateToggle(schemesToggle.set, value)" />
        </div>
        <div class="px-4 py-3">
          <AppFeatureToggle :model-value="variableRestToggle.value.value" :busy="variableRestToggle.busy.value" label="Variable rest per set" description="Override rest time individually for each set" @update:model-value="value => updateToggle(variableRestToggle.set, value)" />
        </div>
      </div>
    </section>

    <section aria-labelledby="data-heading" class="space-y-3">
      <h2 id="data-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
        Data portability
      </h2>
      <p class="text-xs text-(--ui-text-muted)">
        Backups include all supported durable database tables and app preferences; temporary runtime state is excluded.
        Portable training configuration includes templates, Programs, saved routines and personal plans with their calendar rules; it excludes performed workout history.
        Workout history CSV uses local calendar dates, stored kg values, null marker \N, and quoted empty strings.
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton color="primary" icon="i-ph-download-simple" :disabled="operation.busy.value" @click="runOperation(exportBackup)">Download full backup</UButton>
        <UButton color="neutral" icon="i-ph-download-simple" :disabled="operation.busy.value" @click="runOperation(exportCsv)">Download workout CSV</UButton>
        <UButton color="neutral" icon="i-ph-download-simple" :disabled="operation.busy.value" @click="runOperation(exportPortable)">Export training configuration</UButton>
      </div>
      <label class="block text-sm">
        <span class="sr-only">Choose a Hephaestus backup JSON file</span>
        <input type="file" accept="application/json,.json" aria-label="Choose backup file" @change="inspectBackup">
      </label>
      <div v-if="backupPreview" class="rounded-lg bg-(--color-surface) p-3 text-sm" aria-live="polite">
        <p v-if="backupPreview.valid">
          Preview: {{ backupPreview.rowCount }} rows, {{ backupPreview.workoutCount }} workouts,
          {{ backupPreview.templateCount }} templates, {{ backupPreview.programCount }} Programs,
          {{ backupPreview.routineCount ?? 0 }} saved routines, {{ backupPreview.planCount ?? 0 }} personal plans.
        </p>
        <UButton v-if="backupPreview.valid" class="mt-2 text-(--color-danger)" color="error" variant="outline" :disabled="operation.busy.value" @click="restoreConfirmation.request()">
          Replace local data from backup
        </UButton>
      </div>
      <label class="block text-sm">
        <span>Import training configuration from JSON</span>
        <input class="mt-1 block" type="file" accept="application/json,.json" aria-label="Choose training configuration file" @change="inspectPortable">
      </label>
      <div v-if="portablePreview" class="rounded-lg bg-(--color-surface) p-3 text-sm" aria-live="polite">
        <p v-if="portablePreview.valid">
          Preview: {{ portablePreview.templateCount }} templates, {{ portablePreview.programCount }} Programs,
          {{ portablePreview.routineCount ?? 0 }} saved routines, {{ portablePreview.planCount ?? 0 }} personal plans.
        </p>
        <UButton v-if="portablePreview.valid" class="mt-2" color="primary" :disabled="operation.busy.value" @click="importConfirmation.request()">Import without overwriting</UButton>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="resetPreferences" type="checkbox">
        Also reset Hephaestus app preferences (hephaestus-app-settings only)
      </label>
      <UButton class="text-(--color-danger)" color="error" variant="outline" icon="i-ph-trash" :disabled="operation.busy.value" @click="resetConfirmation.request()">
        Reset Hephaestus database
      </UButton>
      <AppOperationFeedback :busy="operation.busy.value" :error="errorMessage || operation.error.value" :success="Boolean(statusMessage)">
        <template #busy>Preparing Hephaestus data…</template>
        <template #success><span role="status">{{ statusMessage }}</span></template>
        <template #error>{{ errorMessage || operation.error.value?.message }}</template>
      </AppOperationFeedback>
      <AppDestructiveConfirm :model-value="restoreConfirmation.pending.value" title="Replace Hephaestus data?" message="Replace all Hephaestus database data and app settings with this backup? This cannot be undone." confirm-label="Replace data" :busy="operation.busy.value" @cancel="restoreConfirmation.cancel()" @confirm="confirmRestore" />
      <AppDestructiveConfirm :model-value="importConfirmation.pending.value" title="Import training configuration?" message="Import these templates, Programs, saved routines and personal plans? Existing content will not be overwritten." confirm-label="Import" :busy="operation.busy.value" @cancel="importConfirmation.cancel()" @confirm="confirmImport" />
      <AppDestructiveConfirm :model-value="resetConfirmation.pending.value" title="Reset Hephaestus database?" message="Clear all Hephaestus application database records? This cannot be undone. App preferences are kept unless you separately confirm their reset." confirm-label="Reset database" :busy="operation.busy.value" @cancel="resetConfirmation.cancel()" @confirm="confirmReset" />
      <AppDestructiveConfirm :model-value="resetPreferencesConfirmation.pending.value" title="Reset app preferences?" message="Also reset Hephaestus app preferences stored under hephaestus-app-settings?" confirm-label="Reset preferences" :busy="operation.busy.value" @cancel="cancelResetPreferences" @confirm="confirmResetPreferences" />
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
          <AppFeatureToggle :model-value="reduceMotionToggle.value.value" :busy="reduceMotionToggle.busy.value" label="Reduce motion" @update:model-value="value => updateToggle(reduceMotionToggle.set, value)" />
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <AppFeatureToggle :model-value="timeFormatToggle.value.value" :busy="timeFormatToggle.busy.value" label="Use 24-hour time" @update:model-value="value => updateToggle(timeFormatToggle.set, value)" />
        </div>
      </div>
    </section>
  </article>
</template>
