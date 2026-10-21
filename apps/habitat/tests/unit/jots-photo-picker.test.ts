import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import JotsCaptureSheet from '~/components/JotsCaptureSheet.vue'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mountSheet(addImageNote: (...args: unknown[]) => Promise<unknown>, urls: string[]) {
  const media = {
    createObjectURL: vi.fn(() => urls.shift() ?? 'blob:unexpected'),
    revokeObjectURL: vi.fn(),
  }
  vi.stubGlobal('useJotsStore', () => ({ addImageNote }))
  vi.stubGlobal('getMediaStore', () => media)
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
  return { media, wrapper }
}

function selectImage(wrapper: ReturnType<typeof mount>, file: File) {
  const gallery = wrapper.get('input[type="file"]:not([capture])')
  Object.defineProperty(gallery.element, 'files', { configurable: true, value: [file] })
  return gallery.trigger('change')
}

function saveButton(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('button')
    .find((button) => button.text() === 'Save')!
}

it('keeps gallery/camera inputs mounted and saves the selected image', async () => {
  const addImageNote = vi.fn().mockResolvedValue(undefined)
  const { media, wrapper } = mountSheet(addImageNote, ['blob:photo-test'])
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

  expect(wrapper.get('input[capture="environment"]').attributes('accept')).toBe('image/*')
  const file = new File(['photo bytes'], 'qa-photo.svg', { type: 'image/svg+xml' })
  await selectImage(wrapper, file)
  expect(wrapper.get('img').attributes('alt')).toBe('qa-photo.svg')
  await saveButton(wrapper).trigger('click')
  await flushPromises()
  expect(addImageNote).toHaveBeenCalledWith(
    expect.objectContaining({ filename: 'qa-photo.svg', mimeType: 'image/svg+xml' }),
    'blob:photo-test',
  )
  expect(media.revokeObjectURL).not.toHaveBeenCalled()
  expect(wrapper.emitted('close')).toHaveLength(1)
  wrapper.unmount()
})

it('releases a replacement preview when the pending image save succeeds', async () => {
  let resolveSave!: () => void
  const addImageNote = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve
      }),
  )
  const { media, wrapper } = mountSheet(addImageNote, ['blob:saving', 'blob:replacement'])
  await selectImage(wrapper, new File(['first'], 'first.png', { type: 'image/png' }))
  const save = saveButton(wrapper).trigger('click')
  await flushPromises()
  await selectImage(wrapper, new File(['replacement'], 'replacement.png', { type: 'image/png' }))

  expect(media.revokeObjectURL).not.toHaveBeenCalled()
  resolveSave()
  await save
  await flushPromises()
  expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:replacement')
  expect(media.revokeObjectURL).not.toHaveBeenCalledWith('blob:saving')
  wrapper.unmount()
})

it('releases both URLs once when a replaced image save fails after unmount', async () => {
  let rejectSave!: (reason: Error) => void
  const addImageNote = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject
      }),
  )
  const { media, wrapper } = mountSheet(addImageNote, ['blob:saving', 'blob:replacement'])
  await selectImage(wrapper, new File(['first'], 'first.png', { type: 'image/png' }))
  const save = saveButton(wrapper).trigger('click')
  await flushPromises()
  await selectImage(wrapper, new File(['replacement'], 'replacement.png', { type: 'image/png' }))

  wrapper.unmount()
  expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:replacement')
  rejectSave(new Error('Save failed'))
  await save
  await flushPromises()
  expect(media.revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:saving')
  expect(media.revokeObjectURL).toHaveBeenCalledTimes(2)
})
