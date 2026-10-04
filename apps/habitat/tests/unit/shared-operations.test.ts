import { computed, defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error The Vue Vite plugin resolves shared SFC imports during tests.
import AppDestructiveConfirm from '@habitathq/shared/app/components/AppDestructiveConfirm.vue'
// @ts-expect-error The Vue Vite plugin resolves shared SFC imports during tests.
import AppFeatureToggle from '@habitathq/shared/app/components/AppFeatureToggle.vue'
// @ts-expect-error The Vue Vite plugin resolves shared SFC imports during tests.
import AppOperationFeedback from '@habitathq/shared/app/components/AppOperationFeedback.vue'
import { AsyncOperationBusyError, useAsyncOperation } from '@habitathq/shared/app/composables/useAsyncOperation'

import { useDestructiveConfirmation } from '@habitathq/shared/app/composables/useDestructiveConfirmation'
import { useFeatureToggle } from '@habitathq/shared/app/composables/useFeatureToggle'

let restoreDialogMethods: (() => void) | undefined

function installDialogMethods() {
  const prototype = HTMLDialogElement.prototype
  const showModal = Object.getOwnPropertyDescriptor(prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(prototype, 'close')
  Object.defineProperty(prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true },
  })
  Object.defineProperty(prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = false },
  })
  restoreDialogMethods = () => {
    if (showModal) Object.defineProperty(prototype, 'showModal', showModal)
    else delete (prototype as Partial<HTMLDialogElement>).showModal
    if (close) Object.defineProperty(prototype, 'close', close)
    else delete (prototype as Partial<HTMLDialogElement>).close
  }
}

afterEach(() => {
  restoreDialogMethods?.()
  restoreDialogMethods = undefined
})

describe('shared operation controls', () => {
  it('does not start duplicate work or reset state while an operation is running', async () => {
    let finish!: (value: string) => void
    let calls = 0
    const operation = useAsyncOperation({
      action: () => {
        calls += 1
        return new Promise<string>((resolve) => { finish = resolve })
      },
    })

    const first = operation.run()
    await expect(operation.run()).rejects.toBeInstanceOf(AsyncOperationBusyError)
    expect(operation.reset()).toBe(false)
    expect(calls).toBe(1)
    finish('done')
    await expect(first).resolves.toBe('done')
  })

  it('normalizes non-Error failures and records rejected success callbacks', async () => {
    const operation = useAsyncOperation({
      action: async () => 'completed',
      onSuccess: async () => { throw 'callback failed' },
    })

    await expect(operation.run()).rejects.toMatchObject({ message: 'callback failed' })
    expect(operation.error.value).toBeInstanceOf(Error)
    expect(operation.error.value?.message).toBe('callback failed')
    expect(operation.status.value).toBe('error')
  })

  it('normalizes feature-update failures, retains them, and releases busy state', async () => {
    const value = ref(false)
    const toggle = useFeatureToggle({ key: 'enabled', value: computed(() => value.value), update: async () => { throw 'write failed' } })

    await expect(toggle.set(true)).rejects.toMatchObject({ message: 'write failed' })
    expect(toggle.error.value?.message).toBe('write failed')
    expect(toggle.busy.value).toBe(false)
  })

  it('consumes staged arguments before a synchronous v-model close setter cancels confirmation', async () => {
    const consumed: string[] = []
    const Harness = defineComponent({
      setup() {
        const confirmation = useDestructiveConfirmation<[string]>()
        confirmation.request('original target')
        const open = computed({
          get: () => confirmation.pending.value,
          set: (next: boolean) => { if (!next) confirmation.cancel() },
        })
        function confirm() {
          const args = confirmation.confirm()
          if (args) consumed.push(args[0])
        }
        return () => h(AppDestructiveConfirm, {
          modelValue: open.value,
          'onUpdate:modelValue': (next: boolean) => { open.value = next },
          onConfirm: confirm,
          title: 'Delete target?',
          message: 'This cannot be undone.',
        })
      },
    })

    installDialogMethods()
    const wrapper = mount(Harness)
    await flushPromises()

    const dialog = wrapper.get('[role="alertdialog"]')
    const titleId = dialog.attributes('aria-labelledby')
    expect(dialog.element.querySelector(`#${titleId}`)?.textContent).toBe('Delete target?')
    await wrapper.get('button:last-child').trigger('click')
    expect(consumed).toEqual(['original target'])
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores custom dialog confirm and cancel actions while busy', async () => {
    installDialogMethods()
    const wrapper = mount(AppDestructiveConfirm, {
      props: { modelValue: true, title: 'Delete target?', busy: true },
      slots: {
        actions: ({ cancel, confirm }: { cancel: () => void; confirm: () => void }) => h('div', [
          h('button', { onClick: cancel }, 'Cancel'),
          h('button', { onClick: confirm }, 'Confirm'),
        ]),
      },
    })
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('exposes a named switch and restores its controlled value after an unaccepted change', async () => {
    const toggle = mount(AppFeatureToggle, { props: { modelValue: false, label: 'Offline mode' } })
    const input = toggle.get('input[role="switch"]')
    expect((input.element as HTMLInputElement).labels?.[0]?.textContent).toContain('Offline mode')

    await input.setValue(true)
    expect(toggle.emitted('update:modelValue')).toEqual([[true]])
    expect((input.element as HTMLInputElement).checked).toBe(false)
    await toggle.setProps({ modelValue: true })
    expect((input.element as HTMLInputElement).checked).toBe(true)

    const feedback = mount(AppOperationFeedback, { props: { error: new Error('Save failed') } })
    expect(feedback.get('[role="alert"]').text()).toContain('Save failed')
  })
})
