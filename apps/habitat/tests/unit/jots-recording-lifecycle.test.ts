import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import JotsRecordSheet from '~/components/JotsRecordSheet.vue'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function recorder() {
  vi.stubGlobal('useJotsStore', () => ({}))
  return mount(JotsRecordSheet, {
    global: {
      stubs: { AppIcon: true, AppIconButton: true, UAlert: true, AppBottomSheet: true },
      mocks: { resolveIcon: (name: string) => name, fmtDuration: () => '0:00' },
    },
  })
}

it('releases a late microphone grant after the recorder has closed', async () => {
  let grant!: (stream: unknown) => void
  const stop = vi.fn()
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        grant = resolve
      }),
  )
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const construct = vi.fn()
  vi.stubGlobal('MediaRecorder', Object.assign(construct, { isTypeSupported: () => true }))
  const wrapper = recorder()
  await wrapper.get('button.record-btn').trigger('click')
  wrapper.unmount()
  grant({ getTracks: () => [{ stop }] })
  await flushPromises()
  expect(stop).toHaveBeenCalledOnce()
  expect(construct).not.toHaveBeenCalled()
})

it('releases microphone tracks if the recorder cannot initialize', async () => {
  const stop = vi.fn()
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) },
  })
  vi.stubGlobal(
    'MediaRecorder',
    Object.assign(
      vi.fn(function () {
        throw new Error('Recorder unavailable')
      }),
      { isTypeSupported: () => true },
    ),
  )
  const wrapper = recorder()
  await wrapper.get('button.record-btn').trigger('click')
  await flushPromises()
  expect(stop).toHaveBeenCalledOnce()
  wrapper.unmount()
})
