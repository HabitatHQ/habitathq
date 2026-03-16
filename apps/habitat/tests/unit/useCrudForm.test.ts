import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useCrudForm } from '~/composables/useCrudForm'

interface Entity { id: string; title: string }
interface Form { title: string }

function makeOptions(overrides: Partial<Parameters<typeof useCrudForm<Form, Entity>>[0]> = {}) {
  const entity: Entity = { id: 'abc', title: 'old' }
  const editing = ref<Entity | null>(null)
  const validate = vi.fn((_f: Form) => null as string | null)
  const buildPayload = vi.fn((f: Form, _e: Entity | null) => ({ title: f.title }))
  const onCreate = vi.fn(async (p: Record<string, unknown>) => ({ id: 'new', title: p['title'] as string }))
  const onUpdate = vi.fn(async (p: Record<string, unknown>) => ({ id: p['id'] as string, title: p['title'] as string }))

  return {
    editing,
    entity,
    options: { editing, validate, buildPayload, onCreate, onUpdate, ...overrides },
    validate,
    buildPayload,
    onCreate,
    onUpdate,
  }
}

describe('useCrudForm', () => {
  it('calls onCreate when editing is null', async () => {
    const { options, onCreate } = makeOptions()
    const { save } = useCrudForm(options)
    await save({ title: 'new task' })
    expect(onCreate).toHaveBeenCalledOnce()
    expect(options.onUpdate).not.toHaveBeenCalled()
  })

  it('calls onUpdate when editing is set', async () => {
    const { options, editing, entity, onUpdate } = makeOptions()
    editing.value = entity
    const { save } = useCrudForm(options)
    await save({ title: 'updated' })
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(options.onCreate).not.toHaveBeenCalled()
  })

  it('passes id to onUpdate payload', async () => {
    const { options, editing, entity, onUpdate } = makeOptions()
    editing.value = entity
    const { save } = useCrudForm(options)
    await save({ title: 'updated' })
    expect(onUpdate.mock.calls[0]![0]).toMatchObject({ id: 'abc', title: 'updated' })
  })

  it('returns the created entity', async () => {
    const { options } = makeOptions()
    const { save } = useCrudForm(options)
    const result = await save({ title: 'new' })
    expect(result).toEqual({ id: 'new', title: 'new' })
  })

  it('sets error and returns null when validate fails', async () => {
    const { options } = makeOptions()
    options.validate = vi.fn(() => 'Title is required')
    const { save, error } = useCrudForm(options)
    const result = await save({ title: '' })
    expect(result).toBeNull()
    expect(error.value).toBe('Title is required')
    expect(options.onCreate).not.toHaveBeenCalled()
  })

  it('clears error on successful save', async () => {
    const { options } = makeOptions()
    const { save, error } = useCrudForm(options)
    options.validate = vi.fn(() => 'err')
    await save({ title: '' })
    expect(error.value).toBe('err')
    options.validate = vi.fn(() => null)
    await save({ title: 'ok' })
    expect(error.value).toBeNull()
  })

  it('saving is true during async call, false after', async () => {
    const { options } = makeOptions()
    let capturedSaving: boolean | null = null
    options.onCreate = vi.fn(async (p) => {
      capturedSaving = true // will be set after this call
      return { id: 'x', title: p['title'] as string }
    })
    const { save, saving } = useCrudForm(options)
    const promise = save({ title: 'x' })
    expect(saving.value).toBe(true)
    await promise
    expect(saving.value).toBe(false)
  })

  it('sets error on DB failure and returns null', async () => {
    const { options } = makeOptions()
    options.onCreate = vi.fn(async () => { throw new Error('DB error') })
    const { save, error } = useCrudForm(options)
    const result = await save({ title: 'x' })
    expect(result).toBeNull()
    expect(error.value).toBe('DB error')
  })

  it('saving is false after a failed save', async () => {
    const { options } = makeOptions()
    options.onCreate = vi.fn(async () => { throw new Error('fail') })
    const { save, saving } = useCrudForm(options)
    await save({ title: 'x' })
    expect(saving.value).toBe(false)
  })
})
