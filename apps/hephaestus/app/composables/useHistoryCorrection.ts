import type {
  HistoryCorrectionDetail,
  HistoryCorrectionDraft,
  HistoryCorrectionPreview,
  HistoryCorrectionResult,
} from '~/types/history-correction'

export function useHistoryCorrection(workoutId: MaybeRefOrGetter<string>) {
  const db = useDatabase()
  const detail = ref<HistoryCorrectionDetail | null>(null)
  const preview = ref<HistoryCorrectionPreview | null>(null)
  const error = ref<string | null>(null)
  const saving = ref(false)
  async function load() {
    error.value = null
    detail.value = await db.history('HISTORY_CORRECTION_READ', { workoutId: toValue(workoutId) })
  }
  async function review(draft: Omit<HistoryCorrectionDraft, 'workoutId' | 'expectedVersion'>) {
    if (!detail.value) await load()
    const value = detail.value
    if (!value) throw new Error('Workout could not be loaded')
    error.value = null
    preview.value = await db.history('HISTORY_CORRECTION_PREVIEW', {
      ...draft,
      workoutId: toValue(workoutId),
      expectedVersion: value.version,
    })
    return preview.value
  }
  async function apply(): Promise<HistoryCorrectionResult> {
    const reviewed = preview.value
    if (!reviewed) throw new Error('Review the correction before applying it')
    saving.value = true
    error.value = null
    try {
      const result = await db.history('HISTORY_CORRECTION_APPLY', {
        previewId: reviewed.previewId,
        fingerprint: reviewed.fingerprint,
      })
      preview.value = null
      detail.value = result.detail
      return result
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }
  return { detail, preview, error, saving, load, review, apply }
}
