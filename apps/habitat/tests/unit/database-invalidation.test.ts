import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDatabase } from '~/composables/useDatabase'

const subscription = vi.hoisted(() => ({
  listener: undefined as (() => void | Promise<void>) | undefined,
  unsubscribe: vi.fn(),
}))
vi.mock('~/plugins/database.client', () => ({
  sendToWorker: vi.fn(),
  onDatabaseChange: (listener: () => void | Promise<void>) => {
    subscription.listener = listener
    return subscription.unsubscribe
  },
}))

function mountDatabase(refresh: () => Promise<void>) {
  return mount(
    defineComponent({
      setup() {
        useDatabase(refresh)
        return () => h('div')
      },
    }),
  )
}

describe('database invalidation', () => {
  beforeEach(() => {
    subscription.listener = undefined
    subscription.unsubscribe.mockClear()
  })
  it('runs a final refresh if a second commit arrives while a read is in progress', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(blocked)
      .mockResolvedValue(undefined)
    const wrapper = mountDatabase(refresh)
    const first = subscription.listener?.()
    await subscription.listener?.()
    expect(refresh).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(refresh).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('unsubscribes and ignores late callbacks after unmount', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const wrapper = mountDatabase(refresh)
    const listener = subscription.listener
    wrapper.unmount()
    await listener?.()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
  })
})
