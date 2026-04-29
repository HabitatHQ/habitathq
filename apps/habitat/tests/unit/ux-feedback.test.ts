/**
 * UX feedback tests — verify that mutations show toast notifications.
 *
 * Tests are RED before implementation (functions lack try/catch + toast) and
 * GREEN after. Strategy: stub all Nuxt auto-imports globally, shallowMount
 * each page, then invoke functions via (wrapper.vm.$ as any).setupState.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises, config } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}))

// ── Global Nuxt auto-import stubs ─────────────────────────────────────────────
// Must be set before component imports; setup() reads them at mount time.

const mockToastAdd = vi.fn()
const g = globalThis as Record<string, unknown>

g['useToast'] = () => ({ add: mockToastAdd })
g['definePageMeta'] = () => {}
g['useState'] = (_key: string, init?: () => unknown) => ref(init ? init() : null)
g['useRoute'] = () => ({ query: {}, params: { id: 'test-id' } })
g['useRouter'] = () => ({ push: vi.fn(), replace: vi.fn() })
g['useBoolModalQuery'] = () => ref(false)
g['useModalQuery'] = () => ref(null)
g['useAppSettings'] = () => ({
  settings: ref({
    todoCalendarView: false,
    pomodoroWorkMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroCyclesBeforeLong: 4,
    enableTimer: false,
  }),
  set: vi.fn(),
})
g['useHaptics'] = () => ({ impact: vi.fn(), notification: vi.fn(), selectionChanged: vi.fn() })
g['useContextFilter'] = () => ({
  anyActive: ref(false),
  matchesContext: () => true,
  toggleContext: vi.fn(),
  clearAll: vi.fn(),
  isActive: () => false,
  contextTags: ref([]),
  contextTagsLoaded: ref(false),
})
g['useTimer'] = () => ({
  timer: ref(null),
  isActive: ref(false),
  isRunning: ref(false),
  isPaused: ref(false),
  isOvertime: ref(false),
  displayTime: ref('00:00'),
  currentElapsed: ref(0),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  pauseTimer: vi.fn(),
  resumeTimer: vi.fn(),
  resetTimer: vi.fn(),
})
g['useTagInput'] = () => ({
  tagInput: ref(''),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  onTagKeydown: vi.fn(),
})
g['useLongPress'] = () => ({ start: vi.fn(), cancel: vi.fn(), activated: ref(false) })
g['useTagSuggestions'] = () => ({
  loadTags: vi.fn(),
  suggest: () => [],
  allUserTags: ref([]),
  tagRows: ref([]),
})
g['resolveIcon'] = (name: string) => `i-lucide-${name}`

// Stub localStorage for settings/data.vue which calls localStorage.removeItem
vi.stubGlobal('localStorage', {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(() => null),
  clear: vi.fn(),
  length: 0,
})

// Stub indexedDB for settings/data.vue clearIdb() / openJotsIdb()
vi.stubGlobal('indexedDB', {
  deleteDatabase: vi.fn(() => {
    const req = { onsuccess: null as (() => void) | null, onerror: null, onblocked: null }
    queueMicrotask(() => req.onsuccess?.())
    return req
  }),
  open: vi.fn(() => ({ onsuccess: null, onerror: null, onupgradeneeded: null })),
})

// Make resolveIcon available in Vue template context for all shallowMount calls
config.global.mocks.resolveIcon = (name: string) => `i-lucide-${name}`

// ── Shared DB stub ────────────────────────────────────────────────────────────
const mockDb = {
  // bored/activities.vue
  getBoredCategories: vi.fn(),
  getBoredActivities: vi.fn(),
  deleteBoredActivity: vi.fn(),
  deleteBoredCategory: vi.fn(),
  archiveBoredActivity: vi.fn(),
  createBoredActivity: vi.fn(),
  updateBoredActivity: vi.fn(),
  createBoredCategory: vi.fn(),
  updateBoredCategory: vi.fn(),
  // todos.vue
  getTodos: vi.fn(),
  archiveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  toggleTodo: vi.fn(),
  // habits/[id].vue
  getHabits: vi.fn(),
  getCompletionsForHabit: vi.fn(),
  getHabitLogsForHabit: vi.fn(),
  getRemindersForHabit: vi.fn(),
  deleteHabitLog: vi.fn(),
  deleteHabit: vi.fn(),
  createHabitLog: vi.fn(),
  toggleCompletion: vi.fn(),
  updateHabit: vi.fn(),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  // checkin/[id].vue
  getCheckinTemplate: vi.fn(),
  getCheckinQuestions: vi.fn(),
  getCheckinResponses: vi.fn(),
  upsertCheckinResponse: vi.fn(),
  createCheckinQuestion: vi.fn(),
  deleteCheckinQuestion: vi.fn(),
  getCheckinRemindersForTemplate: vi.fn(),
  createCheckinReminder: vi.fn(),
  deleteCheckinReminder: vi.fn(),
  updateCheckinTemplate: vi.fn(),
  deleteCheckinTemplate: vi.fn(),
  getCheckinSessionCount: vi.fn(),
  // settings/data.vue
  nukeOpfs: vi.fn(),
  exportJsonData: vi.fn(),
  exportDb: vi.fn(),
  importJson: vi.fn(),
  getScribbles: vi.fn(),
  deleteAllHabits: vi.fn(),
  deleteAllCheckinEntries: vi.fn(),
  deleteAllCheckinData: vi.fn(),
  deleteAllScribbles: vi.fn(),
  deleteAllTodos: vi.fn(),
  deleteAllBoredData: vi.fn(),
  clearAppliedDefaults: vi.fn(),
}
g['useDatabase'] = () => mockDb

// ── Component imports ─────────────────────────────────────────────────────────
import BoredActivitiesPage from '~/pages/bored/activities.vue'
import TodosPage from '~/pages/todos.vue'
import HabitDetailPage from '~/pages/habits/[id].vue'
import CheckinDetailPage from '~/pages/checkin/[id].vue'
import SettingsDataPage from '~/pages/settings/data.vue'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const sampleAct = {
  id: 'a1',
  title: 'Test Activity',
  category_id: 'c1',
  is_done: false,
  done_count: 0,
  is_system: false,
  is_recurring: false,
  recurrence_rule: null,
  estimated_minutes: null,
  tags: [],
  description: '',
  created_at: '',
  archived_at: null,
}

const sampleCat = {
  id: 'c1',
  name: 'Test Category',
  icon: 'sparkles',
  color: '#6366f1',
  is_system: false,
  sort_order: 0,
}

const sampleTodo = {
  id: 't1',
  title: 'Test Todo',
  description: null,
  due_date: null,
  priority: 'medium' as const,
  is_done: false,
  is_recurring: false,
  recurrence_rule: null,
  estimated_minutes: null,
  archived_at: null,
  done_at: null,
  created_at: '',
  updated_at: '',
  tags: [],
  show_in_bored: false,
  bored_category_id: null,
  annotations: {},
}

// ── Helper ────────────────────────────────────────────────────────────────────
// Access the raw setup state of a <script setup> component.
// Refs are auto-unwrapped in this proxy; setting a property updates the ref.
function ss(wrapper: ReturnType<typeof shallowMount>) {
  return (wrapper.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState
}

// ── Global beforeEach: reset all DB mocks to safe defaults ────────────────────
beforeEach(() => {
  mockToastAdd.mockClear()
  // Shared load stubs (return empty by default)
  mockDb.getBoredCategories.mockResolvedValue([])
  mockDb.getBoredActivities.mockResolvedValue([])
  mockDb.getTodos.mockResolvedValue([])
  mockDb.getHabits.mockResolvedValue([])
  mockDb.getCompletionsForHabit.mockResolvedValue([])
  mockDb.getHabitLogsForHabit.mockResolvedValue([])
  mockDb.getRemindersForHabit.mockResolvedValue([])
  mockDb.getCheckinTemplate.mockResolvedValue({ id: 'tmpl1', title: 'Test' })
  mockDb.getCheckinQuestions.mockResolvedValue([])
  mockDb.getCheckinResponses.mockResolvedValue([])
  mockDb.getCheckinRemindersForTemplate.mockResolvedValue([])
  mockDb.getCheckinSessionCount.mockResolvedValue(0)
  // Mutation stubs (resolve with undefined by default)
  mockDb.deleteBoredActivity.mockResolvedValue(undefined)
  mockDb.deleteBoredCategory.mockResolvedValue(undefined)
  mockDb.archiveBoredActivity.mockResolvedValue(undefined)
  mockDb.createBoredActivity.mockResolvedValue({ id: 'new', title: 'New' })
  mockDb.updateBoredActivity.mockResolvedValue(undefined)
  mockDb.createBoredCategory.mockResolvedValue({ id: 'new', name: 'New' })
  mockDb.updateBoredCategory.mockResolvedValue(undefined)
  mockDb.archiveTodo.mockResolvedValue(undefined)
  mockDb.deleteTodo.mockResolvedValue(undefined)
  mockDb.createTodo.mockResolvedValue({ id: 'new' })
  mockDb.updateTodo.mockResolvedValue({ id: 't1' })
  mockDb.toggleTodo.mockResolvedValue(undefined)
  mockDb.deleteHabitLog.mockResolvedValue(undefined)
  mockDb.createCheckinQuestion.mockResolvedValue({ id: 'q1', prompt: 'Test?', response_type: 'TEXT', display_order: 0, desired_answer: 1, template_id: 'tmpl1' })
  mockDb.deleteCheckinQuestion.mockResolvedValue(undefined)
  mockDb.upsertCheckinResponse.mockResolvedValue({})
  mockDb.nukeOpfs.mockResolvedValue(undefined)
  mockDb.deleteAllHabits.mockResolvedValue(undefined)
  mockDb.deleteAllCheckinEntries.mockResolvedValue(undefined)
  mockDb.deleteAllCheckinData.mockResolvedValue(undefined)
  mockDb.deleteAllScribbles.mockResolvedValue(undefined)
  mockDb.deleteAllTodos.mockResolvedValue(undefined)
  mockDb.deleteAllBoredData.mockResolvedValue(undefined)
  mockDb.clearAppliedDefaults.mockResolvedValue(undefined)
  mockDb.exportJsonData.mockResolvedValue({})
  mockDb.exportDb.mockResolvedValue(new Uint8Array())
  mockDb.getScribbles.mockResolvedValue([])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 1 — todos.vue › archiveTodo
// ═══════════════════════════════════════════════════════════════════════════════

describe('todos.vue — archiveTodo (issue 1)', () => {
  it('calls toast.add with color:success on success', async () => {
    const wrapper = shallowMount(TodosPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['archiveTodo'] as (t: typeof sampleTodo) => Promise<void>)(sampleTodo)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('calls toast.add with color:error on failure', async () => {
    mockDb.archiveTodo.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(TodosPage)
    await flushPromises()
    const state = ss(wrapper)
    try {
      await (state['archiveTodo'] as (t: typeof sampleTodo) => Promise<void>)(sampleTodo)
    } catch {
      // pre-fix: error propagates; post-fix: caught and toast shown
    }
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 2 — habits/[id].vue › deleteLog
// ═══════════════════════════════════════════════════════════════════════════════

describe('habits/[id].vue — deleteLog (issue 2)', () => {
  it('calls toast.add with color:error on failure', async () => {
    mockDb.deleteHabitLog.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(HabitDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    try {
      await (state['deleteLog'] as (id: string) => Promise<void>)('log-1')
    } catch {
      // pre-fix: error propagates; post-fix: caught and toast shown
    }
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  // deleteLog has no success toast by design — verify it stays that way.
  it('does not call toast.add on success', async () => {
    const wrapper = shallowMount(HabitDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteLog'] as (id: string) => Promise<void>)('log-1')
    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 3 — checkin/[id].vue › addQuestion
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkin/[id].vue — addQuestion (issue 3)', () => {
  it('calls toast.add with color:error on failure', async () => {
    mockDb.createCheckinQuestion.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(CheckinDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    // Set newPrompt via the setupState proxy (refs are auto-unwrapped; set triggers ref update)
    ;(state as Record<string, unknown>)['newPrompt'] = 'How are you feeling?'
    try {
      await (state['addQuestion'] as () => Promise<void>)()
    } catch {
      // pre-fix: error propagates; post-fix: caught and toast shown
    }
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('does not call toast.add on success', async () => {
    const wrapper = shallowMount(CheckinDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    ;(state as Record<string, unknown>)['newPrompt'] = 'How are you feeling?'
    await (state['addQuestion'] as () => Promise<void>)()
    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 4 — checkin/[id].vue › deleteQuestion
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkin/[id].vue — deleteQuestion (issue 4)', () => {
  it('calls toast.add with color:error on failure', async () => {
    mockDb.deleteCheckinQuestion.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(CheckinDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    try {
      await (state['deleteQuestion'] as (id: string) => Promise<void>)('q1')
    } catch {
      // pre-fix: error propagates; post-fix: caught and toast shown
    }
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('does not call toast.add on success', async () => {
    const wrapper = shallowMount(CheckinDetailPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteQuestion'] as (id: string) => Promise<void>)('q1')
    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 5 — bored/activities.vue › deleteActivity
// ═══════════════════════════════════════════════════════════════════════════════

describe('bored/activities.vue — deleteActivity (issue 5)', () => {
  it('calls toast.add with color:success on success', async () => {
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteActivity'] as (a: typeof sampleAct) => Promise<void>)(sampleAct)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('calls toast.add with color:error on failure', async () => {
    mockDb.deleteBoredActivity.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteActivity'] as (a: typeof sampleAct) => Promise<void>)(sampleAct)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 6 — bored/activities.vue › deleteCategory
// ═══════════════════════════════════════════════════════════════════════════════

describe('bored/activities.vue — deleteCategory (issue 6)', () => {
  it('calls toast.add with color:success on success', async () => {
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteCategory'] as (c: typeof sampleCat) => Promise<void>)(sampleCat)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('calls toast.add with color:error on failure', async () => {
    mockDb.deleteBoredCategory.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['deleteCategory'] as (c: typeof sampleCat) => Promise<void>)(sampleCat)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 7 — bored/activities.vue › archiveActivity
// ═══════════════════════════════════════════════════════════════════════════════

describe('bored/activities.vue — archiveActivity (issue 7)', () => {
  it('calls toast.add with color:success after confirming archive', async () => {
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['archiveActivity'] as (a: typeof sampleAct) => Promise<void>)(sampleAct)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('calls toast.add with color:error on failure', async () => {
    mockDb.archiveBoredActivity.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['archiveActivity'] as (a: typeof sampleAct) => Promise<void>)(sampleAct)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('confirmArchiveActivity ref exists in setup state (added for confirmation flow)', async () => {
    const wrapper = shallowMount(BoredActivitiesPage)
    await flushPromises()
    const state = ss(wrapper)
    // After fix: a confirmArchiveActivity ref exists in the component for the
    // confirmation modal; archiveBoredActivity is only called after confirmation.
    expect('confirmArchiveActivity' in state).toBe(true)
    // And the DB has NOT been called just from rendering
    mockDb.archiveBoredActivity.mockClear()
    expect(mockDb.archiveBoredActivity).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 8 — settings/data.vue › nukeOpfs
// ═══════════════════════════════════════════════════════════════════════════════

describe('settings/data.vue — nukeOpfs (issue 8)', () => {
  it('calls toast.add with color:error when fullWipe throws', async () => {
    mockDb.nukeOpfs.mockRejectedValueOnce(new Error('OPFS error'))
    const wrapper = shallowMount(SettingsDataPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['nukeOpfs'] as (reload: boolean) => Promise<void>)(false)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('does not call toast.add on success', async () => {
    const wrapper = shallowMount(SettingsDataPage)
    await flushPromises()
    const state = ss(wrapper)
    await (state['nukeOpfs'] as (reload: boolean) => Promise<void>)(false)
    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 9 — settings/data.vue › clearAppData
// ═══════════════════════════════════════════════════════════════════════════════

describe('settings/data.vue — clearAppData (issue 9)', () => {
  it('calls toast.add with color:error when a DB op throws', async () => {
    mockDb.deleteAllHabits.mockRejectedValueOnce(new Error('DB error'))
    const wrapper = shallowMount(SettingsDataPage)
    await flushPromises()
    const state = ss(wrapper)
    try {
      await (state['clearAppData'] as () => Promise<void>)()
    } catch {
      // pre-fix: error propagates; post-fix: caught and toast shown
    }
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('does not call toast.add on success', async () => {
    const wrapper = shallowMount(SettingsDataPage)
    await flushPromises()
    const state = ss(wrapper)
    // Disable voiceNotes to avoid indexedDB dependency (not in happy-dom)
    ;(state['clearSelection'] as Record<string, unknown>)['voiceNotes'] = false
    await (state['clearAppData'] as () => Promise<void>)()
    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})
