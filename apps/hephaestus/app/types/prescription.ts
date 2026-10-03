import type { CircuitRestMode, GroupType, LoggingMode, ProgramPhase, SessionType } from './database'

export const PRESCRIPTION_SCHEMA_VERSION = 1 as const
export const PRESCRIPTION_EVALUATOR_VERSION = 'cel-js-8.0.0-js-number-v1' as const

export type SetRole = 'warm_up' | 'working' | 'top' | 'back_off'
export type PrescriptionNumericField =
  | 'weightKg'
  | 'reps'
  | 'restSec'
  | 'durationSec'
  | 'distanceM'
  | 'rpe'
  | 'rir'
export type PrescriptionInputField = PrescriptionNumericField | 'scalar' | 'boolean'
export type RoutineInputValue = number | boolean

export interface PrescriptionInputDefinition {
  id: string
  name: string
  field: PrescriptionInputField
  required: boolean
  defaultValue: number | boolean | null
  minimum: number | null
  maximum: number | null
  integer: boolean
}

export interface FormulaBinding {
  id: string
  variable: string
  source:
    | { kind: 'input'; inputId: string }
    | { kind: 'target'; targetId: string; field: PrescriptionNumericField }
}

export type NumericTargetRule =
  | { kind: 'fixed'; value: number }
  | { kind: 'input'; inputId: string }
  | {
      kind: 'formula'
      source: string
      resultType: 'number' | 'integer'
      bindings: FormulaBinding[]
      evaluatorVersion: string
    }

export interface NumericTarget {
  id: string
  rule: NumericTargetRule
  /** Present only after a real evaluator or a fixed target has resolved the rule. */
  resolvedValue?: number
}

export type RepetitionTarget =
  | { kind: 'exact'; value: NumericTarget }
  | { kind: 'range'; minimum: number; maximum: number }
  | { kind: 'minimum'; minimum: number }

export interface PrescriptionSet {
  id: string
  order: number
  role: SetRole
  reps: RepetitionTarget | null
  weightKg: NumericTarget | null
  restSec: NumericTarget | null
  rpe: NumericTarget | null
  rir: NumericTarget | null
  notes: string | null
  legacyScheme: string | null
}

export interface PrescriptionActivityTargets {
  durationSec: NumericTarget | null
  distanceM: NumericTarget | null
}

export interface PrescriptionActivity {
  id: string
  exerciseId: string
  order: number
  loggingMode: LoggingMode
  executionGroupId: string | null
  sets: PrescriptionSet[]
  targets: PrescriptionActivityTargets
  notes: string | null
}

export interface PrescriptionExecutionGroup {
  id: string
  label: string
  name: string | null
  type: GroupType
  activityIds: string[]
  transitionRestSec: number
  restAfterRoundSec: number
  circuitRestMode: CircuitRestMode
  rounds: number
  amrap: boolean
  timeCapSec: number | null
}

export interface PrescriptionDefaults {
  incrementKg: number
  restSec: number
}

export interface PrescriptionProvenance {
  kind: 'authored' | 'legacy_template'
  migratedAt: string | null
  legacyTemplateId: string | null
  unresolvedFields: string[]
}

export interface SerializablePrescription {
  schemaVersion: typeof PRESCRIPTION_SCHEMA_VERSION
  evaluatorVersion: string
  inputs: PrescriptionInputDefinition[]
  defaults: PrescriptionDefaults
  groups: PrescriptionExecutionGroup[]
  activities: PrescriptionActivity[]
  provenance: PrescriptionProvenance
}

export interface TemplateRevision {
  id: string
  templateId: string
  revisionNumber: number
  prescription: SerializablePrescription
  structureHash: string
  createdAt: string
}

export type RoutineContinuationPolicy = 'calendar_bound' | 'carry_forward'
export type RoutineDeferralMode = 'automatic' | 'manual'

export interface RoutineProvenance {
  templateId: string
  adoptedTemplateRevisionId: string
}

export interface RoutineRevision {
  id: string
  routineId: string
  revisionNumber: number
  prescription: SerializablePrescription
  inputs: Record<string, RoutineInputValue>
  provenance: RoutineProvenance
  structureHash: string
  createdAt: string
}

export interface SavedRoutine {
  id: string
  name: string
  templateId: string
  adoptedTemplateRevisionId: string
  currentRevisionId: string
  continuationPolicy: RoutineContinuationPolicy
  deferralMode: RoutineDeferralMode | null
  createdAt: string
  updatedAt: string
}

export interface ProgramProgressionIntent {
  intensityModifier: number
  volumeModifier: number
  isDeload: boolean
  phase: ProgramPhase | null
  legacyCurrentWeek: number | null
}

export interface ProgramSlot {
  id: string
  templateId: string | null
  templateRevisionId: string | null
  assignmentResolved: boolean
  week: number
  day: number
  label: string | null
  progression: ProgramProgressionIntent
}

export interface ProgramWeekDesign {
  week: number
  progression: ProgramProgressionIntent
}

export interface ProgramDesign {
  schemaVersion: 1
  weeks: number
  weekProgression: ProgramWeekDesign[]
  slots: ProgramSlot[]
}

export interface ProgramRevision {
  id: string
  programId: string
  revisionNumber: number
  design: ProgramDesign
  structureHash: string
  createdAt: string
}

export interface TrainingPlan {
  id: string
  name: string
  programId: string | null
  adoptedProgramRevisionId: string | null
  startLocalDate: string
  active: boolean
  createdAt: string
  updatedAt: string
  legacyProgramState: {
    currentWeek: number
    startedAt: string | null
    completedAt: string | null
  } | null
}

export type PlanBindingStatus = 'bound' | 'unresolved'

export interface TrainingPlanBinding {
  id: string
  planId: string
  programSlotId: string
  templateId: string | null
  routineId: string | null
  status: PlanBindingStatus
  issue: string | null
}

export type CapturedIntentAvailability = 'captured' | 'absent' | 'unavailable'
export type CapturedIntentSourceKind = 'routine' | 'template' | 'one_off' | null

export interface CapturedIntentProvenance {
  sourceKind: CapturedIntentSourceKind
  sourceId: string | null
  sourceRevisionId: string | null
  routineRevisionId: string | null
}

export interface CapturedWorkoutAdjustments {
  scale: number
  intensityModifier: number
  volumeModifier: number
  excludedExerciseIds: string[]
}

export interface CapturedWorkoutIntent {
  workoutId: string
  availability: CapturedIntentAvailability
  prescription: SerializablePrescription | null
  inputs: Record<string, RoutineInputValue>
  adjustments: CapturedWorkoutAdjustments | null
  provenance: CapturedIntentProvenance
  capturedAt: string
}

export interface PrescriptionDraft {
  id?: string
  name: string
  description: string | null
  prescription: SerializablePrescription
}

export interface RoutineDraft {
  id?: string
  name: string
  templateId: string
  templateRevisionId: string
  inputs: Record<string, RoutineInputValue>
  fixedTargetValues: Record<string, number>
  continuationPolicy: RoutineContinuationPolicy
  deferralMode: RoutineDeferralMode | null
}

export interface TemplateAdoptionIssue {
  kind:
    | 'input_removed'
    | 'input_type_changed'
    | 'input_bounds_changed'
    | 'input_required'
    | 'target_removed'
    | 'target_rule_changed'
    | 'target_reference_changed'
  identity: string
  message: string
}

export interface TemplateAdoptionPreview {
  previewId: string
  routineId: string
  currentRoutineRevisionId: string
  targetTemplateRevisionId: string
  compatible: boolean
  issues: TemplateAdoptionIssue[]
  preservedInputs: Record<string, RoutineInputValue>
  preservedFixedTargetValues: Record<string, number>
  prescription: SerializablePrescription
}

export interface TemplateAdoptionApplyRequest {
  previewId: string
  inputs: Record<string, RoutineInputValue>
  fixedTargetValues: Record<string, number>
  now?: string
}

export interface FutureUpdateCandidate {
  id: string
  kind: 'input' | 'fixed_target'
  label: string
  identity: string
  capturedValue: RoutineInputValue
  actualValue: RoutineInputValue | null
  currentValue: RoutineInputValue
  proposedValue: RoutineInputValue
}

export interface FutureUpdatePreview {
  previewId: string
  workoutId: string
  routineId: string
  currentRoutineRevisionId: string
  candidates: FutureUpdateCandidate[]
  ambiguities: string[]
  referencingPlans: Array<{ id: string; name: string }>
  prescription: SerializablePrescription
  inputs: Record<string, RoutineInputValue>
}

export interface FutureUpdateApplyRequest {
  previewId: string
  selectedValues: Record<string, RoutineInputValue>
  now?: string
}

export interface RoutineFutureUpdatePreviewRequest {
  workoutId: string
}

export interface ProgramAdoptionPreview {
  previewId: string
  planId: string
  currentProgramRevisionId: string | null
  targetProgramRevisionId: string
  compatible: boolean
  issues: string[]
  bindings: TrainingPlanBinding[]
  calendar: {
    today: string
    startDate: string
    stateFingerprint: string
    slots: Array<{ slotId: string; label: string; plannedDate: string; routineId: string | null }>
    changes: Array<{
      appointmentId: string | null
      slotId: string
      previousDate: string | null
      previousRoutineId: string | null
      plannedDate: string | null
      routineId: string | null
    }>
  }
}

export interface TemplateCreateRequest extends PrescriptionDraft {
  now?: string
}

export interface TemplateEditRequest {
  templateId: string
  expectedRevisionId: string
  name: string
  description: string | null
  prescription: SerializablePrescription
  now?: string
}

export interface TemplateMetadataUpdateRequest {
  templateId: string
  changes: Record<string, string | number | null>
}

export interface TemplateDuplicateRequest {
  templateId: string
  name?: string
  now?: string
}

export interface RoutineEditRequest {
  routineId: string
  expectedRevisionId: string
  name?: string
  inputs: Record<string, RoutineInputValue>
  fixedTargetValues: Record<string, number>
  continuationPolicy?: RoutineContinuationPolicy
  deferralMode?: RoutineDeferralMode | null
  now?: string
}

export interface ProgramCreateRequest {
  id?: string
  name: string
  description: string | null
  isBuiltin?: boolean
  design: ProgramDesign
  now?: string
}

export interface ProgramEditRequest {
  programId: string
  expectedRevisionId: string
  name: string
  description: string | null
  design: ProgramDesign
  now?: string
}

export interface ProgramAddWeekRequest {
  programId: string
  weekNum: number
  isDeload?: boolean
  intensityModifier?: number
  volumeModifier?: number
  phase?: ProgramPhase | null
}

export interface ProgramAddSlotRequest {
  weekId: string
  dayNum: number
  templateId: string | null
  label?: string
}

export interface TrainingPlanSaveRequest {
  id?: string
  name: string
  programId: string | null
  adoptedProgramRevisionId: string | null
  startLocalDate: string
  active: boolean
  bindings: TrainingPlanBinding[]
  now?: string
}

export interface WorkoutStartRequest {
  id: string
  now: string
  templateId?: string | null
  routineId?: string | null
  options?: {
    scale?: number
    excludedExerciseIds?: string[]
    sessionType?: SessionType
    intensityModifier?: number
    volumeModifier?: number
    inputs?: Record<string, RoutineInputValue>
    fixedTargetValues?: Record<string, number>
  }
}

export interface DomainOperationMap {
  TEMPLATE_CREATE: { payload: TemplateCreateRequest; result: TemplateRevision }
  TEMPLATE_EDIT: { payload: TemplateEditRequest; result: TemplateRevision }
  TEMPLATE_UPDATE_METADATA: { payload: TemplateMetadataUpdateRequest; result: undefined }
  TEMPLATE_DUPLICATE: { payload: TemplateDuplicateRequest; result: TemplateRevision }
  TEMPLATE_GET_REVISION: {
    payload: { templateId: string; revisionId?: string }
    result: TemplateRevision
  }
  ROUTINE_LIST: { payload: Record<string, never>; result: SavedRoutine[] }
  ROUTINE_GET: {
    payload: { routineId: string }
    result: { routine: SavedRoutine; revision: RoutineRevision }
  }
  ROUTINE_SAVE: { payload: RoutineDraft & { now?: string }; result: RoutineRevision }
  ROUTINE_EDIT: { payload: RoutineEditRequest; result: RoutineRevision }
  ROUTINE_PREVIEW_TEMPLATE_ADOPTION: {
    payload: { routineId: string; templateRevisionId: string }
    result: TemplateAdoptionPreview
  }
  ROUTINE_APPLY_TEMPLATE_ADOPTION: {
    payload: TemplateAdoptionApplyRequest
    result: RoutineRevision
  }
  ROUTINE_PREVIEW_FUTURE_UPDATE: {
    payload: RoutineFutureUpdatePreviewRequest
    result: FutureUpdatePreview | null
  }
  ROUTINE_APPLY_FUTURE_UPDATE: { payload: FutureUpdateApplyRequest; result: RoutineRevision }
  PROGRAM_CREATE: { payload: ProgramCreateRequest; result: ProgramRevision }
  PROGRAM_EDIT: { payload: ProgramEditRequest; result: ProgramRevision }
  PROGRAM_GET_REVISION: {
    payload: { programId: string; revisionId?: string }
    result: ProgramRevision
  }
  PROGRAM_ADD_WEEK: { payload: ProgramAddWeekRequest; result: ProgramRevision }
  PROGRAM_ADD_SLOT: { payload: ProgramAddSlotRequest; result: ProgramSlot }
  TRAINING_PLAN_SAVE: { payload: TrainingPlanSaveRequest; result: TrainingPlan }
  TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION: {
    payload: {
      planId: string
      programRevisionId: string
      routineBindings?: Record<string, string | null>
    }
    result: ProgramAdoptionPreview
  }
  TRAINING_PLAN_APPLY_PROGRAM_ADOPTION: {
    payload: { previewId: string; now?: string }
    result: TrainingPlan
  }
  TRAINING_PLAN_BIND_ROUTINE: {
    payload: { planId: string; programSlotId: string; routineId: string }
    result: TrainingPlanBinding
  }
}

export type DomainOperation = keyof DomainOperationMap
