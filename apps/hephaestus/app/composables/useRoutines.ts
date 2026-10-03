import type {
  FutureUpdateApplyRequest,
  FutureUpdatePreview,
  RoutineDraft,
  RoutineEditRequest,
  RoutineRevision,
  SavedRoutine,
  TemplateAdoptionApplyRequest,
  TemplateAdoptionPreview,
} from '~/types/prescription'

export function useRoutines() {
  const db = useDatabase()

  async function load(): Promise<SavedRoutine[]> {
    return db.domain('ROUTINE_LIST', {})
  }

  async function get(
    routineId: string,
  ): Promise<{ routine: SavedRoutine; revision: RoutineRevision }> {
    return db.domain('ROUTINE_GET', { routineId })
  }

  async function save(input: RoutineDraft & { now?: string }): Promise<RoutineRevision> {
    return db.domain('ROUTINE_SAVE', {
      ...input,
      inputs: { ...input.inputs },
      ...(input.fixedTargetValues === undefined
        ? {}
        : { fixedTargetValues: { ...input.fixedTargetValues } }),
    })
  }

  async function edit(input: RoutineEditRequest): Promise<RoutineRevision> {
    return db.domain('ROUTINE_EDIT', {
      ...input,
      inputs: { ...input.inputs },
      fixedTargetValues: { ...input.fixedTargetValues },
    })
  }

  async function previewTemplateAdoption(
    routineId: string,
    templateRevisionId: string,
  ): Promise<TemplateAdoptionPreview> {
    return db.domain('ROUTINE_PREVIEW_TEMPLATE_ADOPTION', { routineId, templateRevisionId })
  }

  async function applyTemplateAdoption(
    request: TemplateAdoptionApplyRequest,
  ): Promise<RoutineRevision> {
    return db.domain('ROUTINE_APPLY_TEMPLATE_ADOPTION', {
      ...request,
      inputs: { ...request.inputs },
      fixedTargetValues: { ...request.fixedTargetValues },
    })
  }

  async function previewFutureUpdate(workoutId: string): Promise<FutureUpdatePreview | null> {
    return db.domain('ROUTINE_PREVIEW_FUTURE_UPDATE', { workoutId })
  }

  async function applyFutureUpdate(request: FutureUpdateApplyRequest): Promise<RoutineRevision> {
    return db.domain('ROUTINE_APPLY_FUTURE_UPDATE', {
      ...request,
      selectedValues: { ...request.selectedValues },
    })
  }

  return {
    load,
    get,
    save,
    edit,
    previewTemplateAdoption,
    applyTemplateAdoption,
    previewFutureUpdate,
    applyFutureUpdate,
  }
}
