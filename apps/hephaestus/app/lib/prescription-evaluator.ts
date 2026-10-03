import { Environment } from '@marcbachmann/cel-js'
import {
  type NumericTarget,
  PRESCRIPTION_EVALUATOR_VERSION,
  type PrescriptionNumericField,
  type RoutineInputValue,
  type SerializablePrescription,
} from '~/types/prescription'
import { roundToAvailableLoad } from './equipment'
import { parseSerializablePrescription, validateRoutineInputs } from './prescription-domain'

const MAX_SOURCE_LENGTH = 512
const MAX_AST_NODES = 96
const MAX_AST_DEPTH = 16
const MAX_CALL_ARGUMENTS = 2
const NUMERIC_FIELDS: Record<PrescriptionNumericField, true> = {
  weightKg: true,
  reps: true,
  restSec: true,
  durationSec: true,
  distanceM: true,
  rpe: true,
  rir: true,
}
type RuntimeExpression = { target: NumericTarget; field: PrescriptionNumericField }
type FormulaEnvironment = {
  evaluate: (context: Record<string, number | boolean>) => number | bigint | boolean
  type: string
}

export class PrescriptionTargetError extends Error {
  constructor(
    readonly targetId: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'PrescriptionTargetError'
  }
}

function atTarget<T>(targetId: string, evaluate: () => T): T {
  try {
    return evaluate()
  } catch (cause) {
    if (cause instanceof PrescriptionTargetError) throw cause
    throw new PrescriptionTargetError(targetId, cause)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new Error('Formula contains an invalid CEL node')
  return value as Record<string, unknown>
}

function validateLiteralNode(node: Record<string, unknown>, args: unknown): void {
  if (typeof args === 'bigint') {
    const numeric = Number(args)
    if (!Number.isSafeInteger(numeric))
      throw new Error('Formula contains an unsafe integer literal')
    Reflect.set(node, 'args', numeric)
    return
  }
  if (typeof args !== 'number' && typeof args !== 'boolean')
    throw new Error('Formula literals must be finite numbers or booleans')
  if (typeof args === 'number' && !Number.isFinite(args))
    throw new Error('Formula literal must be finite')
}

function validateCallNode(
  args: unknown,
  depth: number,
  stats: { nodes: number },
  variables: Set<string>,
): void {
  if (!Array.isArray(args) || typeof args[0] !== 'string' || !Array.isArray(args[1]))
    throw new Error('Formula call is malformed')
  const name = args[0]
  if (name !== 'abs' && name !== 'min' && name !== 'max' && name !== 'roundLoad')
    throw new Error(`Formula function ${name} is not allowed`)
  const children = args[1]
  const expectedArguments = name === 'abs' ? 1 : 2
  if (children.length !== expectedArguments)
    throw new Error(`Formula function ${name} has an unsupported argument count`)
  for (const child of children) validateAst(child, depth + 1, stats, variables)
}

function validateOperatorNode(
  op: string,
  args: unknown,
  depth: number,
  stats: { nodes: number },
  variables: Set<string>,
): boolean {
  if (
    op !== '?:' &&
    op !== '&&' &&
    op !== '||' &&
    !['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', '!_', '-_'].includes(op)
  )
    return false
  const children = Array.isArray(args) ? args : [args]
  for (const child of children) validateAst(child, depth + 1, stats, variables)
  return true
}

function validateAst(
  value: unknown,
  depth: number,
  stats: { nodes: number },
  variables: Set<string>,
): void {
  stats.nodes += 1
  if (stats.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH)
    throw new Error('Formula exceeds the supported expression complexity limit')
  const node = record(value)
  const op = node['op']
  const args = node['args']
  if (typeof op !== 'string') throw new Error('Formula contains an invalid CEL operation')
  if (op === 'value') {
    validateLiteralNode(node, args)
    return
  }
  if (op === 'id') {
    if (typeof args !== 'string' || !variables.has(args))
      throw new Error(`Formula uses unbound variable ${String(args)}`)
    return
  }
  if (op === 'call') {
    validateCallNode(args, depth, stats, variables)
    return
  }
  if (op === 'rcall') throw new Error('Formula member calls are not allowed')
  if (
    op === 'list' ||
    op === 'map' ||
    op === '.' ||
    op === '.?' ||
    op === '[]' ||
    op === '[?]' ||
    op === 'in' ||
    op === 'comprehension' ||
    op.startsWith('accu')
  )
    throw new Error(`Formula AST operation ${op} is not allowed`)
  if (validateOperatorNode(op, args, depth, stats, variables)) return
  throw new Error(`Formula AST operation ${op} is not allowed`)
}

function targetEntries(prescription: SerializablePrescription): RuntimeExpression[] {
  const entries: RuntimeExpression[] = []
  const add = (target: NumericTarget | null, field: PrescriptionNumericField) => {
    if (target) entries.push({ target, field })
  }
  for (const activity of prescription.activities) {
    add(activity.targets.durationSec, 'durationSec')
    add(activity.targets.distanceM, 'distanceM')
    for (const set of activity.sets) {
      if (set.reps?.kind === 'exact') add(set.reps.value, 'reps')
      add(set.weightKg, 'weightKg')
      add(set.restSec, 'restSec')
      add(set.rpe, 'rpe')
      add(set.rir, 'rir')
    }
  }
  return entries
}

function numericAndBooleanInputs(
  prescription: SerializablePrescription,
  inputs: Record<string, RoutineInputValue>,
): Map<string, RoutineInputValue> {
  const checked = validateRoutineInputs(prescription, inputs)
  const result = new Map<string, RoutineInputValue>()
  for (const definition of prescription.inputs) {
    const value = checked[definition.id] ?? definition.defaultValue
    if (typeof value === 'number' || typeof value === 'boolean') result.set(definition.id, value)
  }
  return result
}

function compileFormula(
  source: string,
  bindings: Map<string, RoutineInputValue>,
  targetId: string,
): FormulaEnvironment {
  if (source.length > MAX_SOURCE_LENGTH)
    throw new Error(
      `Formula target ${targetId} exceeds the ${MAX_SOURCE_LENGTH}-character source limit`,
    )
  const variables = new Set(bindings.keys())
  const env = new Environment({
    unlistedVariablesAreDyn: false,
    limits: {
      maxAstNodes: MAX_AST_NODES,
      maxDepth: MAX_AST_DEPTH,
      maxCallArguments: MAX_CALL_ARGUMENTS,
      maxListElements: 0,
      maxMapEntries: 0,
    },
  })
  for (const [name, value] of bindings)
    env.registerVariable(name, typeof value === 'boolean' ? 'bool' : 'double')
  env.registerFunction('abs(double): double', (value: number) => Math.abs(value))
  env.registerFunction('min(double, double): double', (left: number, right: number) =>
    Math.min(left, right),
  )
  env.registerFunction('max(double, double): double', (left: number, right: number) =>
    Math.max(left, right),
  )
  env.registerFunction('roundLoad(double, double): double', (load: number, increment: number) => {
    if (!Number.isFinite(increment) || increment <= 0)
      throw new Error('roundLoad increment must be positive')
    return roundToAvailableLoad(load, {
      minimum_kg: 0,
      increment_kg: increment,
      maximum_kg: null,
      additional_loads_kg: [],
    })
  })
  const parsed = env.parse(source)
  validateAst(parsed.ast, 1, { nodes: 0 }, variables)
  const checked = parsed.check()
  if (!checked.valid)
    throw new Error(
      `Formula target ${targetId} has a type error: ${checked.error?.message ?? 'invalid expression'}`,
    )
  if (checked.type !== 'double' && checked.type !== 'bool' && checked.type !== 'int')
    throw new Error(`Formula target ${targetId} must resolve to a number or boolean condition`)
  return { evaluate: (context) => parsed(context), type: checked.type }
}

export function validatePrescriptionExpressions(prescription: SerializablePrescription): void {
  for (const { target } of targetEntries(prescription)) {
    if (target.rule.kind !== 'formula') continue
    if (target.rule.evaluatorVersion !== PRESCRIPTION_EVALUATOR_VERSION)
      throw new Error(
        `Formula target ${target.id} uses unsupported evaluator ${target.rule.evaluatorVersion}`,
      )
    const variables = new Map<string, RoutineInputValue>()
    for (const binding of target.rule.bindings) {
      if (binding.source.kind === 'input') {
        const inputId = binding.source.inputId
        const definition = prescription.inputs.find((input) => input.id === inputId)
        variables.set(binding.variable, definition?.field === 'boolean' ? false : 0)
      } else variables.set(binding.variable, 0)
    }
    const source = target.rule.source
    const result = atTarget(target.id, () => compileFormula(source, variables, target.id))
    if (
      (target.rule.resultType === 'integer' || target.rule.resultType === 'number') &&
      result.type === 'bool'
    )
      throw new PrescriptionTargetError(
        target.id,
        new Error(`Formula target ${target.id} must return a number`),
      )
  }
}

function validateValue(
  target: NumericTarget,
  field: PrescriptionNumericField,
  resultType: 'number' | 'integer',
  raw: number | bigint | boolean,
): number {
  let value: number
  if (typeof raw === 'bigint') {
    value = Number(raw)
    if (!Number.isSafeInteger(value))
      throw new Error(`Formula target ${target.id} produced an unsafe integer`)
  } else if (typeof raw === 'number') value = raw
  else throw new Error(`Target ${target.id} must resolve to a number for ${field}`)
  if (!Number.isFinite(value)) throw new Error(`Target ${target.id} produced a non-finite value`)
  if (value < 0) throw new Error(`Target ${target.id} for ${field} cannot be negative`)
  if ((resultType === 'integer' || field === 'reps') && !Number.isInteger(value))
    throw new Error(`Target ${target.id} for ${field} requires an integer`)
  if ((field === 'rpe' || field === 'rir') && value > 10)
    throw new Error(`Target ${target.id} for ${field} cannot exceed 10`)
  return value
}
function applyFixedTargetValues(
  fixedTargetValues: Record<string, number>,
  byId: Map<string, RuntimeExpression>,
): void {
  for (const [id, value] of Object.entries(fixedTargetValues)) {
    const entry = byId.get(id)
    if (entry?.target.rule.kind !== 'fixed')
      throw new Error(`Target ${id} is not a directly authored fixed target`)
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Target ${id} must be finite and nonnegative`)
    entry.target.rule.value = value
    entry.target.resolvedValue = value
  }
}

function evaluateFormula(
  targetId: string,
  rule: Extract<NumericTarget['rule'], { kind: 'formula' }>,
  values: Map<string, RoutineInputValue>,
  byId: Map<string, RuntimeExpression>,
  resolving: Set<string>,
  complete: Set<string>,
): number | bigint | boolean {
  if (rule.evaluatorVersion !== PRESCRIPTION_EVALUATOR_VERSION)
    throw new Error(`Target ${targetId} uses unsupported evaluator ${rule.evaluatorVersion}`)
  const context = new Map<string, RoutineInputValue>()
  for (const binding of rule.bindings) {
    if (binding.source.kind === 'input') {
      const input = values.get(binding.source.inputId)
      if (input === undefined)
        throw new Error(`Target ${targetId} requires input ${binding.source.inputId}`)
      context.set(binding.variable, input)
      continue
    }
    if (!NUMERIC_FIELDS[binding.source.field])
      throw new Error(`Target ${targetId} references unsupported target field`)
    const dependency = byId.get(binding.source.targetId)
    if (dependency?.field !== binding.source.field)
      throw new Error(
        `Target ${targetId} references missing ${binding.source.field} target ${binding.source.targetId}`,
      )
    context.set(binding.variable, evaluateTarget(dependency, values, byId, resolving, complete))
  }
  return compileFormula(rule.source, context, targetId).evaluate(Object.fromEntries(context))
}

function evaluateTarget(
  entry: RuntimeExpression,
  values: Map<string, RoutineInputValue>,
  byId: Map<string, RuntimeExpression>,
  resolving: Set<string>,
  complete: Set<string>,
): number {
  const { target, field } = entry
  if (complete.has(target.id)) return target.resolvedValue ?? 0
  if (resolving.has(target.id))
    throw new Error(`Formula target ${target.id} is part of a dependency cycle`)
  resolving.add(target.id)
  const rule = target.rule
  let raw: number | bigint | boolean
  if (rule.kind === 'fixed') raw = rule.value
  else if (rule.kind === 'input') {
    const input = values.get(rule.inputId)
    if (input === undefined) throw new Error(`Target ${target.id} requires input ${rule.inputId}`)
    raw = input
  } else raw = evaluateFormula(target.id, rule, values, byId, resolving, complete)
  const resolvedValue = validateValue(
    target,
    field,
    rule.kind === 'formula' ? rule.resultType : field === 'reps' ? 'integer' : 'number',
    raw,
  )
  target.resolvedValue = resolvedValue
  resolving.delete(target.id)
  complete.add(target.id)
  return resolvedValue
}

export function resolvePrescription(
  prescription: SerializablePrescription,
  inputs: Record<string, RoutineInputValue>,
  fixedTargetValues: Record<string, number> = {},
): SerializablePrescription {
  const resolved = parseSerializablePrescription(prescription)
  const values = numericAndBooleanInputs(resolved, inputs)
  const entries = targetEntries(resolved)
  const byId = new Map(entries.map((entry) => [entry.target.id, entry]))
  applyFixedTargetValues(fixedTargetValues, byId)
  const resolving = new Set<string>()
  const complete = new Set<string>()
  for (const entry of entries)
    atTarget(entry.target.id, () => evaluateTarget(entry, values, byId, resolving, complete))
  resolved.evaluatorVersion = PRESCRIPTION_EVALUATOR_VERSION
  return resolved
}
