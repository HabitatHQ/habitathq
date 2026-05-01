<script setup lang="ts">
const { settings, set } = useAppSettings()

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
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <dt class="text-sm">Weight</dt>
          <dd class="flex gap-2">
            <button
              v-for="u in (['kg', 'lbs'] as const)"
              :key="u"
              class="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              :class="
                settings.weightUnit === u
                  ? 'bg-(--color-accent) text-white'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              :aria-pressed="settings.weightUnit === u"
              @click="set('weightUnit', u)"
            >
              {{ u }}
            </button>
          </dd>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <dt class="text-sm">Distance</dt>
          <dd class="flex gap-2">
            <button
              v-for="u in (['km', 'mi'] as const)"
              :key="u"
              class="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              :class="
                settings.distanceUnit === u
                  ? 'bg-(--color-accent) text-white'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              :aria-pressed="settings.distanceUnit === u"
              @click="set('distanceUnit', u)"
            >
              {{ u }}
            </button>
          </dd>
        </div>
      </dl>
    </section>

    <!-- Workout defaults -->
    <section aria-labelledby="defaults-heading">
      <h2
        id="defaults-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Workout Defaults
      </h2>
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <dt class="text-sm">Default rest timer</dt>
            <dd class="text-sm font-medium text-(--color-accent)">{{ settings.defaultRestSeconds }}s</dd>
          </div>
          <div class="flex gap-2 flex-wrap" role="group" aria-label="Rest timer options">
            <button
              v-for="secs in restOptions"
              :key="secs"
              class="px-2.5 py-1 text-xs rounded-full transition-colors"
              :class="
                settings.defaultRestSeconds === secs
                  ? 'bg-(--color-accent) text-white'
                  : 'bg-(--color-surface-2) text-(--ui-text-muted)'
              "
              :aria-pressed="settings.defaultRestSeconds === secs"
              @click="set('defaultRestSeconds', secs)"
            >
              {{ secs }}s
            </button>
          </div>
        </div>
        <!-- Warm-up ramps -->
        <div class="px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <dt class="text-sm">Warm-up ramps</dt>
            <dd class="text-xs text-(--ui-text-muted)">% of working weight</dd>
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
          <dt class="text-sm">Show RPE field</dt>
          <dd>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.showRpe ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
              :aria-pressed="settings.showRpe"
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
          </dd>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <dt class="text-sm">Show RIR field</dt>
          <dd>
            <button
              class="relative w-10 h-6 rounded-full transition-colors"
              :class="settings.showRir ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
              :aria-pressed="settings.showRir"
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
          </dd>
        </div>
      </dl>
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
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border) mb-3">
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <dt class="text-sm">Warm-up suggestions</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Ramp calculator button in the add-set sheet</dd>
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
            <dt class="text-sm">Failure rest prompt</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Toast after logging a failure — "Take extra rest?"</dd>
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
            <dt class="text-sm">Session notes</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Notes field on the finish-workout sheet</dd>
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
      </dl>

      <!-- Template builder -->
      <p class="text-xs text-(--ui-text-muted) mb-1.5 px-1">Template builder</p>
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <dt class="text-sm">Superset groups</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Assign exercises to supersets, circuits, or giant sets</dd>
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
            <dt class="text-sm">Set schemes</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Pyramid, drop sets, rest-pause progressions</dd>
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
            <dt class="text-sm">Variable rest per set</dt>
            <dd class="text-xs text-(--ui-text-muted) mt-0.5">Override rest time individually for each set</dd>
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
      </dl>
    </section>

    <!-- Accessibility -->
    <section aria-labelledby="a11y-heading">
      <h2
        id="a11y-heading"
        class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
      >
        Accessibility
      </h2>
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3">
          <dt class="text-sm">Reduce motion</dt>
          <dd>
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
          </dd>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <dt class="text-sm">24-hour time</dt>
          <dd>
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
          </dd>
        </div>
      </dl>
    </section>
  </article>
</template>
