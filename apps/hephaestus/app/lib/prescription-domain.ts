import {
  type NumericTarget,
  PRESCRIPTION_SCHEMA_VERSION,
  type PrescriptionActivity,
  type PrescriptionDraft,
  type PrescriptionInputDefinition,
  type PrescriptionNumericField,
  type SerializablePrescription,
} from '~/types/prescription'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isObjectRecord(value)) throw new Error(`${path} must be an object`)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${path} must be finite`)
  return value
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path)
}

function parseTarget(value: unknown, path: string): NumericTarget {
  const target = record(value, path)
  const rule = record(target['rule'], `${path}.rule`)
  const kind = string(rule['kind'], `${path}.rule.kind`)
  let parsedRule: NumericTarget['rule']
  if (kind === 'fixed') parsedRule = { kind, value: number(rule['value'], `${path}.rule.value`) }
  else if (kind === 'input')
    parsedRule = { kind, inputId: string(rule['inputId'], `${path}.rule.inputId`) }
  else if (kind === 'formula') {
    if (!Array.isArray(rule['bindings'])) throw new Error(`${path}.rule.bindings must be an array`)
    const bindings = rule['bindings'].map((item, index) => {
      const binding = record(item, `${path}.rule.bindings[${index}]`)
      const source = record(binding['source'], `${path}.rule.bindings[${index}].source`)
      const sourceKind = string(source['kind'], `${path}.rule.bindings[${index}].source.kind`)
      const parsedSource =
        sourceKind === 'input'
          ? {
              kind: 'input' as const,
              inputId: string(source['inputId'], `${path}.rule.bindings[${index}].source.inputId`),
            }
          : sourceKind === 'target'
            ? (() => {
                const field = string(
                  source['field'],
                  `${path}.rule.bindings[${index}].source.field`,
                )
                if (
                  ![
                    'weightKg',
                    'reps',
                    'restSec',
                    'durationSec',
                    'distanceM',
                    'rpe',
                    'rir',
                  ].includes(field)
                )
                  throw new Error(`${path}.rule.bindings[${index}].source.field is unsupported`)
                return {
                  kind: 'target' as const,
                  targetId: string(
                    source['targetId'],
                    `${path}.rule.bindings[${index}].source.targetId`,
                  ),
                  field: field as PrescriptionNumericField,
                }
              })()
            : null
      if (!parsedSource)
        throw new Error(`${path}.rule.bindings[${index}].source.kind is unsupported`)
      return {
        id: string(binding['id'], `${path}.rule.bindings[${index}].id`),
        variable: string(binding['variable'], `${path}.rule.bindings[${index}].variable`),
        source: parsedSource,
      }
    })
    const resultType = string(rule['resultType'], `${path}.rule.resultType`)
    if (resultType !== 'number' && resultType !== 'integer')
      throw new Error(`${path}.rule.resultType is unsupported`)
    parsedRule = {
      kind,
      source: string(rule['source'], `${path}.rule.source`),
      resultType,
      bindings,
      evaluatorVersion: string(rule['evaluatorVersion'], `${path}.rule.evaluatorVersion`),
    }
  } else throw new Error(`${path}.rule.kind is unsupported`)
  const result: NumericTarget = { id: string(target['id'], `${path}.id`), rule: parsedRule }
  if (target['resolvedValue'] !== undefined)
    result.resolvedValue = number(target['resolvedValue'], `${path}.resolvedValue`)
  return result
}

function parseReps(value: unknown, path: string): PrescriptionActivity['sets'][number]['reps'] {
  if (value === null) return null
  const reps = record(value, path)
  const kind = string(reps['kind'], `${path}.kind`)
  if (kind === 'exact') return { kind, value: parseTarget(reps['value'], `${path}.value`) }
  if (kind === 'range')
    return {
      kind,
      minimum: number(reps['minimum'], `${path}.minimum`),
      maximum: number(reps['maximum'], `${path}.maximum`),
    }
  if (kind === 'minimum') return { kind, minimum: number(reps['minimum'], `${path}.minimum`) }
  throw new Error(`${path}.kind is unsupported`)
}

function parseInputField(value: string, path: string): PrescriptionInputDefinition['field'] {
  if (
    value === 'weightKg' ||
    value === 'reps' ||
    value === 'restSec' ||
    value === 'durationSec' ||
    value === 'distanceM' ||
    value === 'rpe' ||
    value === 'rir' ||
    value === 'scalar' ||
    value === 'boolean'
  )
    return value
  throw new Error(`${path}.field is unsupported`)
}

function parseGroupType(
  value: string,
  path: string,
): SerializablePrescription['groups'][number]['type'] {
  if (
    value === 'superset' ||
    value === 'giant_set' ||
    value === 'circuit' ||
    value === 'pre_exhaust'
  )
    return value
  throw new Error(`${path} has unsupported mode`)
}

function parseCircuitRestMode(
  value: string,
  path: string,
): SerializablePrescription['groups'][number]['circuitRestMode'] {
  if (value === 'after_round' || value === 'after_each') return value
  throw new Error(`${path} has unsupported mode`)
}

function parseSetRole(value: string, path: string): PrescriptionActivity['sets'][number]['role'] {
  if (value === 'warm_up' || value === 'working' || value === 'top' || value === 'back_off')
    return value
  throw new Error(`${path}.role is unsupported`)
}

function parseLoggingMode(value: string, path: string): PrescriptionActivity['loggingMode'] {
  if (value === 'strength' || value === 'cardio' || value === 'distance') return value
  throw new Error(`${path}.loggingMode is unsupported`)
}

function parseInput(value: unknown, index: number): PrescriptionInputDefinition {
  const path = `inputs[${index}]`
  const input = record(value, path)
  const field = parseInputField(string(input['field'], `${path}.field`), path)
  const defaultValue = input['defaultValue']
  if (
    defaultValue !== null &&
    typeof defaultValue !== 'boolean' &&
    typeof defaultValue !== 'number'
  )
    throw new Error(`${path}.defaultValue is malformed`)
  const optionalNumber = (key: string) =>
    input[key] === null ? null : number(input[key], `${path}.${key}`)
  if (typeof input['required'] !== 'boolean' || typeof input['integer'] !== 'boolean')
    throw new Error(`${path} flags are malformed`)
  return {
    id: string(input['id'], `${path}.id`),
    name: string(input['name'], `${path}.name`),
    field,
    required: input['required'],
    defaultValue,
    minimum: optionalNumber('minimum'),
    maximum: optionalNumber('maximum'),
    integer: input['integer'],
  }
}

function parseGroup(value: unknown, index: number): SerializablePrescription['groups'][number] {
  const path = `groups[${index}]`
  const group = record(value, path)
  if (!Array.isArray(group['activityIds'])) throw new Error(`${path}.activityIds must be an array`)
  const type = parseGroupType(string(group['type'], `${path}.type`), path)
  const restMode = parseCircuitRestMode(
    string(group['circuitRestMode'], `${path}.circuitRestMode`),
    path,
  )
  if (typeof group['amrap'] !== 'boolean') throw new Error(`${path}.amrap must be boolean`)
  return {
    id: string(group['id'], `${path}.id`),
    label: string(group['label'], `${path}.label`),
    name: nullableString(group['name'], `${path}.name`),
    type,
    activityIds: group['activityIds'].map((id, activityIndex) =>
      string(id, `${path}.activityIds[${activityIndex}]`),
    ),
    transitionRestSec: number(group['transitionRestSec'], `${path}.transitionRestSec`),
    restAfterRoundSec: number(group['restAfterRoundSec'], `${path}.restAfterRoundSec`),
    circuitRestMode: restMode,
    rounds: number(group['rounds'], `${path}.rounds`),
    amrap: group['amrap'],
    timeCapSec:
      group['timeCapSec'] === null ? null : number(group['timeCapSec'], `${path}.timeCapSec`),
  }
}

function parseActivitySet(value: unknown, activityIndex: number, setIndex: number) {
  const path = `activities[${activityIndex}].sets[${setIndex}]`
  const set = record(value, path)
  const role = parseSetRole(string(set['role'], `${path}.role`), path)
  const optionalTarget = (key: string) =>
    set[key] === null ? null : parseTarget(set[key], `${path}.${key}`)
  return {
    id: string(set['id'], `${path}.id`),
    order: number(set['order'], `${path}.order`),
    role,
    reps: parseReps(set['reps'], `${path}.reps`),
    weightKg: optionalTarget('weightKg'),
    restSec: optionalTarget('restSec'),
    rpe: optionalTarget('rpe'),
    rir: optionalTarget('rir'),
    notes: nullableString(set['notes'], `${path}.notes`),
    legacyScheme: nullableString(set['legacyScheme'], `${path}.legacyScheme`),
  }
}

function parseActivity(value: unknown, index: number): PrescriptionActivity {
  const path = `activities[${index}]`
  const activity = record(value, path)
  if (!Array.isArray(activity['sets'])) throw new Error(`${path}.sets must be an array`)
  const mode = parseLoggingMode(string(activity['loggingMode'], `${path}.loggingMode`), path)
  const targets = record(activity['targets'], `${path}.targets`)
  const sets = activity['sets'].map((set, setIndex) => parseActivitySet(set, index, setIndex))
  const optionalTarget = (key: string) =>
    targets[key] === null ? null : parseTarget(targets[key], `${path}.targets.${key}`)
  return {
    id: string(activity['id'], `${path}.id`),
    exerciseId: string(activity['exerciseId'], `${path}.exerciseId`),
    order: number(activity['order'], `${path}.order`),
    loggingMode: mode,
    executionGroupId: nullableString(activity['executionGroupId'], `${path}.executionGroupId`),
    sets,
    targets: {
      durationSec: optionalTarget('durationSec'),
      distanceM: optionalTarget('distanceM'),
    },
    notes: nullableString(activity['notes'], `${path}.notes`),
  }
}

function parseProvenance(value: unknown): SerializablePrescription['provenance'] {
  const provenance = record(value, 'provenance')
  const kind = string(provenance['kind'], 'provenance.kind')
  if (kind !== 'authored' && kind !== 'legacy_template')
    throw new Error('provenance.kind is unsupported')
  if (!Array.isArray(provenance['unresolvedFields']))
    throw new Error('provenance.unresolvedFields must be an array')
  return {
    kind,
    migratedAt: nullableString(provenance['migratedAt'], 'provenance.migratedAt'),
    legacyTemplateId: nullableString(provenance['legacyTemplateId'], 'provenance.legacyTemplateId'),
    unresolvedFields: provenance['unresolvedFields'].map((value, index) =>
      string(value, `provenance.unresolvedFields[${index}]`),
    ),
  }
}

export function parseSerializablePrescription(value: unknown): SerializablePrescription {
  const root = record(value, 'prescription')
  if (root['schemaVersion'] !== PRESCRIPTION_SCHEMA_VERSION)
    throw new Error('prescription.schemaVersion is unsupported')
  if (
    !Array.isArray(root['inputs']) ||
    !Array.isArray(root['groups']) ||
    !Array.isArray(root['activities'])
  )
    throw new Error('prescription arrays are malformed')
  const defaults = record(root['defaults'], 'defaults')
  return validatePrescription({
    schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
    evaluatorVersion: string(root['evaluatorVersion'], 'evaluatorVersion'),
    inputs: root['inputs'].map(parseInput),
    defaults: {
      incrementKg: number(defaults['incrementKg'], 'defaults.incrementKg'),
      restSec: number(defaults['restSec'], 'defaults.restSec'),
    },
    groups: root['groups'].map(parseGroup),
    activities: root['activities'].map(parseActivity),
    provenance: parseProvenance(root['provenance']),
  })
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function finiteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be finite and nonnegative`)
}

function uuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`${label} must be a stable UUID`)
}

function boundedUnique(values: string[], label: string): Set<string> {
  const result = new Set<string>()
  for (const value of values) {
    uuid(value, label)
    if (result.has(value)) throw new Error(`${label} values must be unique`)
    result.add(value)
  }
  return result
}

function validateBooleanInput(input: PrescriptionInputDefinition): void {
  if (typeof input.defaultValue !== 'boolean' && input.defaultValue !== null)
    throw new Error('Boolean input default must be true, false or null')
  if (input.minimum !== null || input.maximum !== null || input.integer)
    throw new Error('Boolean inputs cannot define numeric bounds or integer semantics')
}

function validateNumericInputBounds(input: PrescriptionInputDefinition): void {
  if (typeof input.defaultValue === 'boolean')
    throw new Error('Numeric input default must be a number or null')
  if (input.defaultValue !== null) finiteNonnegative(input.defaultValue, 'Input default')
  if (input.minimum !== null) finiteNonnegative(input.minimum, 'Input minimum')
  if (input.maximum !== null) finiteNonnegative(input.maximum, 'Input maximum')
  if (input.minimum !== null && input.maximum !== null && input.minimum > input.maximum)
    throw new Error('Input minimum cannot exceed maximum')
  if (input.defaultValue !== null && input.minimum !== null && input.defaultValue < input.minimum)
    throw new Error('Input default is below its minimum')
  if (input.defaultValue !== null && input.maximum !== null && input.defaultValue > input.maximum)
    throw new Error('Input default exceeds its maximum')
  if (input.integer && input.defaultValue !== null && !Number.isInteger(input.defaultValue))
    throw new Error('Integer prescription input requires an integer default')
}

function validateRepInputValues(input: PrescriptionInputDefinition): void {
  if (
    input.field === 'reps' &&
    (!input.integer ||
      (input.minimum !== null && (!Number.isInteger(input.minimum) || input.minimum < 1)) ||
      (input.maximum !== null && (!Number.isInteger(input.maximum) || input.maximum < 1)) ||
      (typeof input.defaultValue === 'number' &&
        (!Number.isInteger(input.defaultValue) || input.defaultValue < 1)))
  )
    throw new Error('Rep inputs must be positive integers')
}

function validateNumericInputField(input: PrescriptionInputDefinition): void {
  validateRepInputValues(input)
  if (
    (input.field === 'rpe' || input.field === 'rir') &&
    ((input.minimum !== null && input.minimum > 10) ||
      (input.maximum !== null && input.maximum > 10) ||
      (typeof input.defaultValue === 'number' && input.defaultValue > 10))
  )
    throw new Error(`${input.field} inputs cannot exceed 10`)
}

function validateInput(input: PrescriptionInputDefinition): void {
  uuid(input.id, 'Input identity')
  if (!input.name.trim()) throw new Error('Prescription input name is required')
  if (input.field === 'boolean') {
    validateBooleanInput(input)
    return
  }
  validateNumericInputBounds(input)
  validateNumericInputField(input)
}

function validateFormulaBindingVariables(
  target: NumericTarget,
  inputs: Map<string, PrescriptionInputDefinition>,
): void {
  if (target.rule.kind !== 'formula') return
  const rule = target.rule
  if (!rule.source.trim() || !rule.evaluatorVersion.trim())
    throw new Error('Formula source and evaluator semantics version are required')
  boundedUnique(
    rule.bindings.map((binding) => binding.id),
    'Formula binding identity',
  )
  const variableNames = new Set<string>()
  for (const binding of rule.bindings) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.variable) || variableNames.has(binding.variable))
      throw new Error('Formula binding variable names must be unique identifiers')
    variableNames.add(binding.variable)
    if (binding.source.kind === 'input' && !inputs.has(binding.source.inputId))
      throw new Error(`Formula target ${target.id} has an unresolved input binding`)
  }
}

function validateTarget(
  target: NumericTarget,
  inputs: Map<string, PrescriptionInputDefinition>,
  targets: Set<string>,
): void {
  uuid(target.id, 'Prescription target identity')
  if (targets.has(target.id)) throw new Error('Prescription target identities must be unique')
  targets.add(target.id)
  const rule = target.rule
  if (rule.kind === 'fixed') finiteNonnegative(rule.value, 'Fixed target')
  if (rule.kind === 'input') {
    const input = inputs.get(rule.inputId)
    if (!input) throw new Error(`Target ${target.id} references a missing input`)
    if (input.field === 'boolean')
      throw new Error(`Target ${target.id} cannot use a boolean input directly`)
  }
  validateFormulaBindingVariables(target, inputs)
  if (target.resolvedValue !== undefined) finiteNonnegative(target.resolvedValue, 'Resolved target')
}

function targetFields(
  activity: PrescriptionActivity,
): Array<{ target: NumericTarget; field: PrescriptionNumericField }> {
  const result: Array<{ target: NumericTarget; field: PrescriptionNumericField }> = []
  const add = (target: NumericTarget | null, field: PrescriptionNumericField) => {
    if (target) result.push({ target, field })
  }
  add(activity.targets.durationSec, 'durationSec')
  add(activity.targets.distanceM, 'distanceM')
  for (const set of activity.sets) {
    add(set.weightKg, 'weightKg')
    add(set.restSec, 'restSec')
    add(set.rpe, 'rpe')
    add(set.rir, 'rir')
    if (set.reps?.kind === 'exact') add(set.reps.value, 'reps')
  }
  return result
}

function validatePrescriptionDefaults(prescription: SerializablePrescription): void {
  if (prescription.schemaVersion !== PRESCRIPTION_SCHEMA_VERSION)
    throw new Error('Unsupported prescription schema version')
  finiteNonnegative(prescription.defaults.incrementKg, 'Default load increment')
  if (prescription.defaults.incrementKg === 0)
    throw new Error('Default load increment must be positive')
  finiteNonnegative(prescription.defaults.restSec, 'Default rest')
}

function validatedInputs(
  definitions: PrescriptionInputDefinition[],
): Map<string, PrescriptionInputDefinition> {
  const inputs = new Map<string, PrescriptionInputDefinition>()
  for (const input of definitions) {
    validateInput(input)
    if (inputs.has(input.id)) throw new Error('Prescription input identities must be unique')
    inputs.set(input.id, input)
  }
  return inputs
}

function validateSet(
  set: PrescriptionActivity['sets'][number],
  setIds: Set<string>,
  priorOrder: number,
): void {
  if (
    !setIds.has(set.id) ||
    !Number.isInteger(set.order) ||
    set.order < 1 ||
    set.order <= priorOrder
  )
    throw new Error('Sets must have stable UUIDs and ascending positive order values')
  if (
    set.role !== 'warm_up' &&
    set.role !== 'working' &&
    set.role !== 'top' &&
    set.role !== 'back_off'
  )
    throw new Error('Unsupported prescription set role')
}

function targetValues(target: NumericTarget): number[] {
  const values = target.rule.kind === 'fixed' ? [target.rule.value] : []
  if (target.resolvedValue !== undefined) values.push(target.resolvedValue)
  return values
}

function validateTargetField(
  target: NumericTarget,
  field: PrescriptionNumericField,
  inputs: Map<string, PrescriptionInputDefinition>,
  targetIds: Set<string>,
): void {
  validateTarget(target, inputs, targetIds)
  const values = targetValues(target)
  const limit = field === 'rpe' || field === 'rir' ? 10 : null
  if (limit !== null && values.some((value) => value > limit))
    throw new Error(`${field} target cannot exceed ${limit}`)
  if (field === 'reps' && values.some((value) => !Number.isInteger(value) || value < 1))
    throw new Error('Exact reps target must be a positive integer')
  if (target.rule.kind !== 'input') return
  const input = inputs.get(target.rule.inputId)
  if (input && input.field !== 'scalar' && input.field !== field)
    throw new Error(`Target ${target.id} requires a ${field} input`)
}

function validateActivityOrder(activity: PrescriptionActivity, previousOrder: number): void {
  if (!Number.isInteger(activity.order) || activity.order < 1 || activity.order <= previousOrder)
    throw new Error('Activities must have unique ascending positive order values')
}

function validateActivity(
  activity: PrescriptionActivity,
  previousOrder: number,
  groupIds: Set<string>,
  seenActivityIds: Set<string>,
  inputs: Map<string, PrescriptionInputDefinition>,
  targetIds: Set<string>,
): void {
  uuid(activity.exerciseId, 'Exercise identity')
  validateActivityOrder(activity, previousOrder)
  if (seenActivityIds.has(activity.id)) throw new Error('Activity identities must be unique')
  seenActivityIds.add(activity.id)
  if (activity.executionGroupId !== null && !groupIds.has(activity.executionGroupId))
    throw new Error('Activity references a missing execution group')
  const setIds = boundedUnique(
    activity.sets.map((set) => set.id),
    'Set identity',
  )
  let priorSetOrder = 0
  for (const set of activity.sets) {
    validateSet(set, setIds, priorSetOrder)
    priorSetOrder = set.order
  }
  for (const { target, field } of targetFields(activity))
    validateTargetField(target, field, inputs, targetIds)
}

function validateFormulaReferences(
  prescription: SerializablePrescription,
  targetIds: Set<string>,
): void {
  const targetFieldById = new Map<string, PrescriptionNumericField>()
  for (const activity of prescription.activities)
    for (const { target, field } of targetFields(activity)) targetFieldById.set(target.id, field)
  for (const activity of prescription.activities)
    for (const { target } of targetFields(activity))
      validateFormulaTargetReferences(target, targetIds, targetFieldById)
}

function validateFormulaTargetReferences(
  target: NumericTarget,
  targetIds: Set<string>,
  targetFieldById: Map<string, PrescriptionNumericField>,
): void {
  if (target.rule.kind !== 'formula') return
  for (const binding of target.rule.bindings) {
    if (binding.source.kind !== 'target') continue
    if (!targetIds.has(binding.source.targetId))
      throw new Error(`Formula target ${target.id} references a missing target`)
    if (targetFieldById.get(binding.source.targetId) !== binding.source.field)
      throw new Error(
        `Formula target ${target.id} references a target as ${binding.source.field}, but its authored field differs`,
      )
  }
}

function validateExecutionGroup(
  group: SerializablePrescription['groups'][number],
  activityIds: Set<string>,
): void {
  uuid(group.id, 'Execution group identity')
  finiteNonnegative(group.transitionRestSec, 'Group transition rest')
  finiteNonnegative(group.restAfterRoundSec, 'Group round rest')
  if (!Number.isInteger(group.rounds) || group.rounds < 1)
    throw new Error('Group rounds must be positive')
  if (group.timeCapSec !== null) finiteNonnegative(group.timeCapSec, 'Group time cap')
  const seen = new Set<string>()
  for (const activityId of group.activityIds) {
    uuid(activityId, 'Grouped activity identity')
    if (!activityIds.has(activityId) || seen.has(activityId))
      throw new Error('Execution group contains a missing or duplicate activity')
    seen.add(activityId)
  }
}

function validateActivityGroupMembership(
  activity: PrescriptionActivity,
  groups: SerializablePrescription['groups'],
): void {
  if (activity.executionGroupId === null) return
  const group = groups.find((entry) => entry.id === activity.executionGroupId)
  if (!group?.activityIds.includes(activity.id))
    throw new Error('Activity and execution group membership must agree')
}

export function validatePrescription(
  prescription: SerializablePrescription,
): SerializablePrescription {
  validatePrescriptionDefaults(prescription)
  const inputs = validatedInputs(prescription.inputs)
  const activityIds = boundedUnique(
    prescription.activities.map((activity) => activity.id),
    'Activity identity',
  )
  const groupIds = boundedUnique(
    prescription.groups.map((group) => group.id),
    'Execution group identity',
  )
  const seenActivityIds = new Set<string>()
  const targetIds = new Set<string>()
  let previousActivityOrder = 0
  for (const activity of prescription.activities) {
    validateActivity(activity, previousActivityOrder, groupIds, seenActivityIds, inputs, targetIds)
    previousActivityOrder = activity.order
  }
  validateFormulaReferences(prescription, targetIds)
  for (const group of prescription.groups) validateExecutionGroup(group, activityIds)
  for (const activity of prescription.activities)
    validateActivityGroupMembership(activity, prescription.groups)
  return prescription
}

export function structuralFingerprint(prescription: SerializablePrescription): string {
  const structure = {
    groups: prescription.groups.map(({ id, type, activityIds, rounds, amrap }) => ({
      id,
      type,
      activityIds,
      rounds,
      amrap,
    })),
    activities: prescription.activities.map((activity) => ({
      id: activity.id,
      exerciseId: activity.exerciseId,
      order: activity.order,
      loggingMode: activity.loggingMode,
      executionGroupId: activity.executionGroupId,
      sets: activity.sets.map(({ id, order, role }) => ({ id, order, role })),
    })),
  }
  let hash = 2166136261
  for (const character of JSON.stringify(structure)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

function validateNumericRoutineInput(
  input: PrescriptionInputDefinition,
  value: number | boolean,
): void {
  if (typeof value !== 'number') throw new Error(`Input ${input.name} must be numeric`)
  finiteNonnegative(value, `Input ${input.name}`)
  if ((input.field === 'reps' || input.integer) && (!Number.isInteger(value) || value < 1))
    throw new Error(`Input ${input.name} requires a positive integer`)
  if ((input.field === 'rpe' || input.field === 'rir') && value > 10)
    throw new Error(`Input ${input.name} cannot exceed 10`)
  if (input.minimum !== null && value < input.minimum)
    throw new Error(`Input ${input.name} is below its minimum`)
  if (input.maximum !== null && value > input.maximum)
    throw new Error(`Input ${input.name} exceeds its maximum`)
}

function validateRoutineInputValue(
  input: PrescriptionInputDefinition,
  value: number | boolean,
): void {
  if (input.field !== 'boolean') {
    validateNumericRoutineInput(input, value)
    return
  }
  if (typeof value !== 'boolean') throw new Error(`Input ${input.name} must be boolean`)
}

export function validateRoutineInputs(
  prescription: SerializablePrescription,
  values: Record<string, number | boolean>,
): Record<string, number | boolean> {
  const known = new Map(prescription.inputs.map((input) => [input.id, input]))
  for (const [id, value] of Object.entries(values)) {
    const input = known.get(id)
    if (!input) throw new Error(`Unknown routine input ${id}`)
    validateRoutineInputValue(input, value)
  }
  for (const input of known.values()) {
    if (input.required && values[input.id] === undefined && input.defaultValue === null)
      throw new Error(`Required routine input ${input.name} is unresolved`)
  }
  return { ...values }
}

export function validatePrescriptionDraft(draft: PrescriptionDraft): PrescriptionDraft {
  if (!draft.name.trim()) throw new Error('Name is required')
  if (draft.id !== undefined && !isUuid(draft.id))
    throw new Error('Template identity must be a stable UUID')
  validatePrescription(draft.prescription)
  return draft
}
