<script setup lang="ts">
const { settings, set } = useAppSettings()

const themes = [
  { label: 'Hephaestus', value: 'hephaestus' as const, desc: 'Dark · Orange flame' },
  { label: 'Forge', value: 'forge' as const, desc: 'Dark · Steel blue' },
  { label: 'Daylight', value: 'daylight' as const, desc: 'Light · Warm orange' },
]

const restOptions = [60, 90, 120, 150, 180, 240, 300]
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
