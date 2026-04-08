import { vi } from 'vitest'

// Stub useHaptics globally so all component tests that use it don't fail.
const g = globalThis as Record<string, unknown>
g['useHaptics'] = () => ({
  impact: vi.fn(),
  notification: vi.fn(),
  selectionChanged: vi.fn(),
})

// Stub logError (auto-imported from ~/utils/error in Nuxt, but not in test env)
g['logError'] = vi.fn()
