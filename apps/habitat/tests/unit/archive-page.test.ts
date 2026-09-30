import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ArchivePage from '~/pages/archive.vue'

const getArchivedHabits = vi.fn().mockResolvedValue([])
const globals = globalThis as Record<string, unknown>
globals['useDatabase'] = () => ({ getArchivedHabits })

describe('archive page', () => {
  it('shows archived habits without duplicating check-in history', async () => {
    const wrapper = mount(ArchivePage, {
      global: {
        stubs: {
          AppCard: true,
          AppIcon: true,
          BackNav: true,
          EmptyState: true,
        },
      },
    })
    await flushPromises()

    expect(getArchivedHabits).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Archive')
    expect(wrapper.text()).not.toContain('Check-in')
  })
})
