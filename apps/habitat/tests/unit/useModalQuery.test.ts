import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'

// We test the composable logic directly by importing it and providing a router
import { useModalQuery, useBoolModalQuery } from '~/composables/useModalQuery'

function createTestRouter(initialPath = '/') {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
}

describe('useModalQuery', () => {
  it('initialises to null when no query param is present', async () => {
    const router = createTestRouter('/')
    await router.push('/')

    const TestComponent = defineComponent({
      setup() {
        const modal = useModalQuery(['text', 'picker'] as const)
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.vm.modal).toBeNull()
  })

  it('initialises from a valid query param on mount', async () => {
    const router = createTestRouter()
    await router.push('/?modal=text')

    const TestComponent = defineComponent({
      setup() {
        const modal = useModalQuery(['text', 'picker'] as const)
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.vm.modal).toBe('text')
  })

  it('ignores invalid query param values', async () => {
    const router = createTestRouter()
    await router.push('/?modal=invalid')

    const TestComponent = defineComponent({
      setup() {
        const modal = useModalQuery(['text', 'picker'] as const)
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.vm.modal).toBeNull()
  })

  it('updates URL when ref changes to a valid value', async () => {
    const router = createTestRouter()
    await router.push('/')

    const modalRef = ref<string | null>(null)

    const TestComponent = defineComponent({
      setup() {
        const modal = useModalQuery(['text', 'picker'] as const)
        // expose for test manipulation
        modalRef.value = modal.value
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    wrapper.vm.modal = 'picker'
    await flushPromises()

    expect(router.currentRoute.value.query['modal']).toBe('picker')
  })

  it('removes URL param when ref is set to null', async () => {
    const router = createTestRouter()
    await router.push('/?modal=text')

    const TestComponent = defineComponent({
      setup() {
        const modal = useModalQuery(['text', 'picker'] as const)
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.vm.modal).toBe('text')

    wrapper.vm.modal = null
    await flushPromises()

    expect(router.currentRoute.value.query['modal']).toBeUndefined()
  })

  it('clears URL param when set to a value not in validModals', async () => {
    const router = createTestRouter()
    await router.push('/?modal=text')

    const TestComponent = defineComponent({
      setup() {
        // 'transcript' not in valid list — setting it should clear the URL
        const modal = useModalQuery(['text', 'picker'] as const)
        return { modal }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, {
      global: { plugins: [router] },
    })
    await flushPromises()

    // Force set to an out-of-list value (simulates internal-only modal)
    // @ts-expect-error intentional type bypass for test
    wrapper.vm.modal = 'transcript'
    await flushPromises()

    expect(router.currentRoute.value.query['modal']).toBeUndefined()
  })
})

describe('useBoolModalQuery', () => {
  it('initialises to false when no query param', async () => {
    const router = createTestRouter()
    await router.push('/')

    const TestComponent = defineComponent({
      setup() {
        const open = useBoolModalQuery('add')
        return { open }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.vm.open).toBe(false)
  })

  it('initialises to true when matching query param is present', async () => {
    const router = createTestRouter()
    await router.push('/?modal=add')

    const TestComponent = defineComponent({
      setup() {
        const open = useBoolModalQuery('add')
        return { open }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.vm.open).toBe(true)
  })

  it('stays false for a different modal name', async () => {
    const router = createTestRouter()
    await router.push('/?modal=create')

    const TestComponent = defineComponent({
      setup() {
        const open = useBoolModalQuery('add')
        return { open }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.vm.open).toBe(false)
  })

  it('sets URL param when opened', async () => {
    const router = createTestRouter()
    await router.push('/')

    const TestComponent = defineComponent({
      setup() {
        const open = useBoolModalQuery('add')
        return { open }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, { global: { plugins: [router] } })
    await flushPromises()

    wrapper.vm.open = true
    await flushPromises()

    expect(router.currentRoute.value.query['modal']).toBe('add')
  })

  it('removes URL param when closed', async () => {
    const router = createTestRouter()
    await router.push('/?modal=add')

    const TestComponent = defineComponent({
      setup() {
        const open = useBoolModalQuery('add')
        return { open }
      },
      template: '<div />',
    })

    const wrapper = mount(TestComponent, { global: { plugins: [router] } })
    await flushPromises()

    wrapper.vm.open = false
    await flushPromises()

    expect(router.currentRoute.value.query['modal']).toBeUndefined()
  })
})
