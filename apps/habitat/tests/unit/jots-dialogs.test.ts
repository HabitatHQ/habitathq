import { flushPromises, shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JotsPage from '~/pages/jots/index.vue'
import type { JotItem } from '~/composables/useJotsStore'
import AppBottomSheet from '../../../../libs/habitat-shared/app/components/AppBottomSheet.vue'

const timeline = ref<JotItem[]>([])

function mountPage() {
  return shallowMount(JotsPage, {
    global: {
      components: { AppBottomSheet },
      stubs: {
        AppBottomSheet: false,
        AppIcon: true,
        AppIconButton: true,
        AppCard: true,
        AppListSection: true,
        JotWaveform: true,
        JotsRing: true,
        JotsRecordSheet: true,
        JotsCaptureSheet: true,
        USwitch: true,
        teleport: true,
        AppTextField: { props: ['modelValue'], template: '<input :value="modelValue" />' },
        UButton: { template: '<button><slot /></button>' },
        UFormField: { template: '<label><slot /></label>' },
        USlideover: true,
      },
      renderStubDefaultSlot: true,
      mocks: {
        resolveIcon: (name: string) => name,
        fmtDuration: () => '0:10',
        timeAgo: () => 'Just now',
      },
    },
  })
}

describe('Jots dialogs', () => {
  beforeEach(() => {
    timeline.value = []
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useDatabase', () => ({ getRecentSharedScribbles: async () => [] }))
    vi.stubGlobal('useJotsStore', () => ({
      timeline,
      todoByJotId: ref(new Map()),
      todos: ref([]),
      loadAll: async () => {},
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps rename and TODO fields out of the landing page until opened', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('No jots yet')
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens and cancels each dialog from a voice jot', async () => {
    timeline.value = [
      {
        kind: 'voice',
        data: {
          id: 'voice-1',
          title: 'Morning idea',
          duration: 10,
          created_at: '2026-10-17T08:00:00Z',
          blob: new Blob(),
          mimeType: 'audio/webm',
          url: '',
        },
      },
    ]
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('[aria-label="Rename voice note"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Rename voice note')
    expect(wrapper.get('input').element.value).toBe('Morning idea')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    expect(wrapper.findAll('input')).toHaveLength(0)

    await wrapper.get('[aria-label="Link to todo"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Create TODO')
    expect(wrapper.findAll('input')).toHaveLength(2)
    expect(wrapper.findAll('input')[0]!.element.value).toBe('Revisit: Morning idea')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(0)
    wrapper.unmount()
  })

  it.each(['list', 'grid'])('shows missing media honestly in %s view', async (view) => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'jots-view' ? view : null),
      setItem: vi.fn(),
    })
    timeline.value = [
      {
        kind: 'voice',
        data: {
          id: 'missing-voice',
          title: 'A recording',
          duration: 10,
          mimeType: 'audio/webm',
          blob: new Blob(),
          created_at: '2026-10-17T08:00:00Z',
        },
      },
      {
        kind: 'image',
        data: {
          id: 'missing-image',
          title: 'A photo',
          filename: 'photo.png',
          mimeType: 'image/png',
          blob: new Blob(),
          created_at: '2026-10-17T08:00:00Z',
        },
      },
    ]
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.get('[aria-label="Play voice note"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text().match(/Not available on this device/g)).toHaveLength(2)
    expect(wrapper.findAll('img')).toHaveLength(0)
    wrapper.unmount()
  })
})
