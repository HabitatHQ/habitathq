import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import JotsCaptureSheet from '~/components/JotsCaptureSheet.vue'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps gallery/camera inputs mounted and saves the selected image', async () => {
  const addImageNote = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('useJotsStore', () => ({ addImageNote }))
  vi.stubGlobal('getMediaStore', () => ({
    createObjectURL: () => 'blob:photo-test',
    revokeObjectURL: vi.fn(),
  }))
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  const wrapper = mount(JotsCaptureSheet, {
    global: {
      stubs: {
        UButton: { template: '<button><slot /></button>' },
        AppIcon: true,
        AppIconButton: true,
        UAlert: true,
      },
      mocks: { resolveIcon: (name: string) => name },
    },
  })
  const gallery = wrapper.get('input[type="file"]:not([capture])')
  expect(wrapper.get('input[capture="environment"]').attributes('accept')).toBe('image/*')
  const file = new File(['photo bytes'], 'qa-photo.svg', { type: 'image/svg+xml' })
  Object.defineProperty(gallery.element, 'files', { value: [file] })
  await gallery.trigger('change')
  expect(wrapper.get('img').attributes('alt')).toBe('qa-photo.svg')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Save')!
    .trigger('click')
  await flushPromises()
  expect(addImageNote).toHaveBeenCalledWith(
    expect.objectContaining({ filename: 'qa-photo.svg', mimeType: 'image/svg+xml' }),
    'blob:photo-test',
  )
  expect(wrapper.emitted('close')).toHaveLength(1)
  wrapper.unmount()
})
