import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Stub Nuxt auto-imports used by JotsRing
vi.stubGlobal('useAppSettings', () => ({ settings: ref({ reduceMotion: false }) }))
vi.stubGlobal('resolveIcon', (name: string) => `i-lucide-${name}`)

import JotsRing from '~/components/JotsRing.vue'

// ─── JotsRing ─────────────────────────────────────────────────────────────────

describe('JotsRing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders three ring-node buttons in default mode', () => {
    const wrapper = mount(JotsRing, {
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.findAll('button.jots-ring-node')).toHaveLength(3)
  })

  it('emits select with "text" when the text node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button[data-jot-type="text"]').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['text'])
  })

  it('emits select with "voice" when the voice node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button[data-jot-type="voice"]').trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['voice'])
  })

  it('emits select with "image" when the image node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button[data-jot-type="image"]').trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['image'])
  })

  it('renders compact mode with three buttons', () => {
    const wrapper = mount(JotsRing, {
      props: { compact: true },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.findAll('button')).toHaveLength(3)
  })

  it('emits select from compact mode', async () => {
    const wrapper = mount(JotsRing, {
      props: { compact: true },
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button[data-jot-type="text"]').trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['text'])
  })
})
