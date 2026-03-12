import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Stub Nuxt auto-imports used by JotsRing
vi.stubGlobal('useAppSettings', () => ({ settings: ref({ reduceMotion: false }) }))

import JotsRing from '~/components/JotsRing.vue'

// ─── JotsRing ─────────────────────────────────────────────────────────────────

describe('JotsRing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('mounts without errors', () => {
    const wrapper = mount(JotsRing, {
      global: {
        stubs: { UIcon: true },
      },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('emits select with "text" when the text node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: {
        stubs: { UIcon: true },
      },
    })
    // The ring nodes are buttons — find and click the Scribble (text) one
    const buttons = wrapper.findAll('button.jots-ring-node')
    const textBtn = buttons.find((b) => b.text().includes('Scribble'))
    expect(textBtn).toBeDefined()
    await textBtn!.trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['text'])
  })

  it('emits select with "voice" when the voice node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: {
        stubs: { UIcon: true },
      },
    })
    const buttons = wrapper.findAll('button.jots-ring-node')
    const voiceBtn = buttons.find((b) => b.text().includes('Voice'))
    expect(voiceBtn).toBeDefined()
    await voiceBtn!.trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['voice'])
  })

  it('emits select with "image" when the image node is clicked', async () => {
    const wrapper = mount(JotsRing, {
      global: {
        stubs: { UIcon: true },
      },
    })
    const buttons = wrapper.findAll('button.jots-ring-node')
    const imageBtn = buttons.find((b) => b.text().includes('Photograph'))
    expect(imageBtn).toBeDefined()
    await imageBtn!.trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['image'])
  })

  it('renders compact mode with three buttons', () => {
    const wrapper = mount(JotsRing, {
      props: { compact: true },
      global: {
        stubs: { UIcon: true },
      },
    })
    // Compact renders grid buttons (not .jots-ring-node)
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBe(3)
  })

  it('emits select from compact mode', async () => {
    const wrapper = mount(JotsRing, {
      props: { compact: true },
      global: {
        stubs: { UIcon: true },
      },
    })
    const buttons = wrapper.findAll('button')
    const textBtn = buttons.find((b) => b.text().includes('Scribble'))
    expect(textBtn).toBeDefined()
    await textBtn!.trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['text'])
  })
})
