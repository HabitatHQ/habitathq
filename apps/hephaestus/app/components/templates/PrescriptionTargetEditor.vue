<script setup lang="ts">
import { toRaw } from 'vue'
import type {
  FormulaBinding,
  NumericTarget,
  PrescriptionInputDefinition,
  PrescriptionNumericField,
} from '~/types/prescription'

export interface TargetReferenceOption {
  targetId: string
  activityId: string
  activityName: string
  setId: string | null
  setOrder: number | null
  role: string | null
  field: PrescriptionNumericField
  label: string
}

const props = defineProps<{
  modelValue: NumericTarget | null
  field: PrescriptionNumericField
  label: string
  inputs: PrescriptionInputDefinition[]
  references: TargetReferenceOption[]
  validationMessage?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: NumericTarget | null] }>()
const uid = () => crypto.randomUUID()
const version = 'cel-js-8.0.0-js-number-v1'
const numericInputs = computed(() => props.inputs.filter((input) => input.field !== 'boolean'))
const formulaInputs = computed(() => props.inputs)

function createTarget(): NumericTarget {
  return { id: uid(), rule: { kind: 'fixed', value: 0 }, resolvedValue: 0 }
}
function updateTarget(update: (target: NumericTarget) => void) {
  const target = structuredClone(toRaw(props.modelValue ?? createTarget()))
  update(target)
  emit('update:modelValue', target)
}
function setMode(mode: string) {
  updateTarget((target) => {
    const currentValue =
      target.rule.kind === 'fixed'
        ? target.rule.value
        : (target.resolvedValue ?? (props.field === 'reps' ? 1 : 0))
    if (mode === 'fixed') target.rule = { kind: 'fixed', value: currentValue }
    else if (mode === 'input')
      target.rule = { kind: 'input', inputId: numericInputs.value[0]?.id ?? '' }
    else
      target.rule = {
        kind: 'formula',
        source: '',
        resultType: props.field === 'reps' ? 'integer' : 'number',
        bindings: [],
        evaluatorVersion: version,
      }
    delete target.resolvedValue
  })
}
function changeInput(id: string) {
  updateTarget((target) => {
    if (target.rule.kind === 'input') target.rule.inputId = id
  })
}
function updateFixed(value: number) {
  updateTarget((target) => {
    if (target.rule.kind === 'fixed') {
      target.rule.value = value
      target.resolvedValue = value
    }
  })
}
function updateSource(source: string) {
  updateTarget((target) => {
    if (target.rule.kind === 'formula') target.rule.source = source
  })
}
function addBinding() {
  if (
    props.modelValue?.rule.kind !== 'formula' ||
    formulaInputs.value.length + props.references.length === 0
  )
    return
  updateTarget((target) => {
    if (target.rule.kind !== 'formula') return
    const index = target.rule.bindings.length + 1
    const input = formulaInputs.value[0]
    const reference = props.references.find((entry) => entry.targetId !== target.id)
    const source: FormulaBinding['source'] = input
      ? { kind: 'input', inputId: input.id }
      : reference
        ? { kind: 'target', targetId: reference.targetId, field: reference.field }
        : { kind: 'input', inputId: '' }
    target.rule.bindings.push({ id: uid(), variable: `value${index}`, source })
  })
}
function setBinding(bindingId: string, value: string) {
  updateTarget((target) => {
    if (target.rule.kind !== 'formula') return
    const binding = target.rule.bindings.find((entry) => entry.id === bindingId)
    if (!binding) return
    const [kind, identity, field] = value.split('|')
    if (kind === 'input') binding.source = { kind, inputId: identity ?? '' }
    else if (kind === 'target' && isNumericField(field))
      binding.source = { kind, targetId: identity ?? '', field }
  })
}
function setVariable(bindingId: string, variable: string) {
  updateTarget((target) => {
    if (target.rule.kind === 'formula') {
      const binding = target.rule.bindings.find((entry) => entry.id === bindingId)
      if (binding) binding.variable = variable
    }
  })
}
function removeBinding(bindingId: string) {
  updateTarget((target) => {
    if (target.rule.kind === 'formula')
      target.rule.bindings = target.rule.bindings.filter((binding) => binding.id !== bindingId)
  })
}
function bindingValue(binding: FormulaBinding): string {
  return binding.source.kind === 'input'
    ? `input|${binding.source.inputId}|`
    : `target|${binding.source.targetId}|${binding.source.field}`
}
function isNumericField(value: string | undefined): value is PrescriptionNumericField {
  return (
    value === 'weightKg' ||
    value === 'reps' ||
    value === 'restSec' ||
    value === 'durationSec' ||
    value === 'distanceM' ||
    value === 'rpe' ||
    value === 'rir'
  )
}
</script>

<template>
  <fieldset class="space-y-2 rounded border border-(--ui-border) p-2">
    <legend class="px-1 text-sm font-medium">{{ label }}</legend>
    <div class="flex flex-wrap gap-2">
      <label class="flex-1">Target mode<select :value="modelValue?.rule.kind ?? 'absent'" class="mt-1 w-full rounded bg-(--color-surface) p-2" :aria-label="`${label} target mode`" @change="$event => { const mode = ($event.target as HTMLSelectElement).value; mode === 'absent' ? emit('update:modelValue', null) : setMode(mode) }"><option value="absent">Not prescribed</option><option value="fixed">Fixed</option><option value="input" :disabled="numericInputs.length === 0">Input</option><option value="formula">Formula</option></select></label>
      <label v-if="modelValue?.rule.kind === 'fixed'" class="flex-1">Value<input :value="modelValue.rule.value" type="number" min="0" step="any" class="mt-1 w-full rounded bg-(--color-surface) p-2" :aria-label="`${label} fixed value`" @input="updateFixed(Number(($event.target as HTMLInputElement).value))" /></label>
      <label v-else-if="modelValue?.rule.kind === 'input'" class="flex-1">Named input<select :value="modelValue.rule.inputId" class="mt-1 w-full rounded bg-(--color-surface) p-2" @change="changeInput(($event.target as HTMLSelectElement).value)"><option v-for="input in numericInputs" :key="input.id" :value="input.id">{{ input.name || 'Unnamed input' }} · {{ input.field }}</option></select></label>
    </div>
    <template v-if="modelValue?.rule.kind === 'formula'">
      <label class="block">CEL formula<textarea :value="modelValue.rule.source" rows="2" class="mt-1 w-full rounded bg-(--color-surface) p-2 font-mono text-sm" :aria-label="`${label} formula source`" placeholder="workingLoad * 0.9" @input="updateSource(($event.target as HTMLTextAreaElement).value)" /></label>
      <div v-for="binding in modelValue.rule.bindings" :key="binding.id" class="grid grid-cols-[minmax(4rem,0.7fr)_minmax(0,1.3fr)_auto] gap-2">
        <input :value="binding.variable" class="min-w-0 rounded bg-(--color-surface) p-2 font-mono" aria-label="Formula variable" @input="setVariable(binding.id, ($event.target as HTMLInputElement).value)" />
        <select :value="bindingValue(binding)" class="min-w-0 rounded bg-(--color-surface) p-2" aria-label="Formula binding source" @change="setBinding(binding.id, ($event.target as HTMLSelectElement).value)"><optgroup label="Configuration inputs"><option v-for="input in formulaInputs" :key="input.id" :value="`input|${input.id}|`">{{ input.name || 'Unnamed input' }} · {{ input.field }}</option></optgroup><optgroup label="Planned target references"><option v-for="reference in references" :key="`${reference.targetId}:${reference.field}`" :value="`target|${reference.targetId}|${reference.field}`">{{ reference.label }} · {{ reference.field }}</option></optgroup></select>
        <button type="button" class="rounded px-2" :aria-label="`Remove ${binding.variable} binding`" @click="removeBinding(binding.id)">Remove</button>
      </div>
      <UButton type="button" size="xs" variant="outline" :disabled="formulaInputs.length + references.length === 0" @click="addBinding">Add formula reference</UButton>
      <p class="text-xs text-(--ui-text-muted)">Allowed helpers: abs, min, max, roundLoad. Formulas read only named inputs and planned numeric targets.</p>
    </template>
    <p v-if="validationMessage" role="alert" class="text-xs text-red-400">{{ label }}: {{ validationMessage }}</p>
  </fieldset>
</template>
