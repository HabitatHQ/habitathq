import { config } from '@vue/test-utils'
import { vi } from 'vitest'
import SproutFigure from '~/components/SproutFigure.vue'

// Nuxt auto-registers app components; the unit-test env doesn't, so register the
// shared figure used by SproutPlant + HabitGarden.
config.global.components = { ...config.global.components, SproutFigure }

// Stub useHaptics globally so all component tests that use it don't fail.
const g = globalThis as Record<string, unknown>
g['useHaptics'] = () => ({
  impact: vi.fn(),
  notification: vi.fn(),
  selectionChanged: vi.fn(),
})

// Stub logError (auto-imported from ~/utils/error in Nuxt, but not in test env)
g['logError'] = vi.fn()

// Stub useFirstVisit (auto-imported composable). Return true so mounted pages
// behave like first load — the entrance class is applied.
g['useFirstVisit'] = () => true
