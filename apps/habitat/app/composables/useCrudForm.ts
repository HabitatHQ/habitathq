interface UseCrudFormOptions<TForm, TEntity extends { id: string }> {
  editing: Ref<TEntity | null>
  validate: (form: TForm) => string | null
  buildPayload: (form: TForm, existing: TEntity | null) => Record<string, unknown>
  onCreate: (payload: Record<string, unknown>) => Promise<TEntity>
  onUpdate: (payload: Record<string, unknown>) => Promise<TEntity>
}

/**
 * Composable that orchestrates the validate → build payload → create/update
 * flow for CRUD forms.
 *
 * The caller retains control over: modal close, list updates, and toast messages.
 */
export function useCrudForm<TForm, TEntity extends { id: string }>(
  options: UseCrudFormOptions<TForm, TEntity>,
) {
  const saving = ref(false)
  const error = ref<string | null>(null)

  async function save(form: TForm): Promise<TEntity | null> {
    const validationError = options.validate(form)
    if (validationError) {
      error.value = validationError
      return null
    }
    error.value = null
    saving.value = true
    try {
      const payload = options.buildPayload(form, options.editing.value)
      if (options.editing.value) {
        return await options.onUpdate({ id: options.editing.value.id, ...payload })
      } else {
        return await options.onCreate(payload)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      saving.value = false
    }
  }

  return { saving, error, save }
}
