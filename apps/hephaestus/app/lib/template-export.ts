import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import type { TemplateGroupRow, TemplateRow } from '~/types/database'

export const EXPORT_VERSION = 1

export interface ExportPayload {
  version: number
  exportedAt: string
  template: {
    name: string
    description: string | null
    cover_emoji: string | null
  }
  exercises: Array<{
    exercise_name: string
    exercise_movement: string
    order_num: number
    sets_planned: number | null
    reps_planned: string | null
    rpe_target: number | null
    rest_seconds: number
    set_scheme: string | null
    notes: string | null
    tempo: string | null
    superset_group: string | null
  }>
  groups: Array<{
    label: string
    group_type: string
    display_name: string | null
    rounds: number
  }>
}

export function buildExportPayload(
  template: TemplateRow,
  exercises: TemplateExerciseWithName[],
  groups: TemplateGroupRow[],
): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    template: {
      name: template.name,
      description: template.description,
      cover_emoji: template.cover_emoji,
    },
    exercises: exercises.map((ex) => ({
      exercise_name: ex.exercise_name,
      exercise_movement: ex.exercise_movement,
      order_num: ex.order_num,
      sets_planned: ex.sets_planned,
      reps_planned: ex.reps_planned,
      rpe_target: ex.rpe_target,
      rest_seconds: ex.rest_seconds,
      set_scheme: ex.set_scheme,
      notes: ex.notes,
      tempo: ex.tempo,
      superset_group: ex.superset_group,
    })),
    groups: groups.map((g) => ({
      label: g.label,
      group_type: g.group_type,
      display_name: g.display_name,
      rounds: g.rounds,
    })),
  }
}

export function validateImportPayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  if (typeof p['version'] !== 'number') return false
  if (typeof p['template'] !== 'object' || p['template'] === null) return false
  const t = p['template'] as Record<string, unknown>
  if (typeof t['name'] !== 'string' || !t['name']) return false
  if (!Array.isArray(p['exercises'])) return false
  return true
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * Encode payload as compact base64 string for QR codes.
 * Strips ids and icon data to minimize size.
 */
export function payloadToQrData(payload: ExportPayload): string {
  const compact = JSON.stringify({
    v: payload.version,
    t: {
      n: payload.template.name,
      d: payload.template.description,
      e: payload.template.cover_emoji,
    },
    x: payload.exercises.map((ex) => ({
      n: ex.exercise_name,
      m: ex.exercise_movement,
      o: ex.order_num,
      s: ex.sets_planned,
      r: ex.reps_planned,
      rs: ex.rest_seconds,
    })),
  })
  return utf8ToBase64(compact)
}

/**
 * Decode QR data string back to a partial ExportPayload.
 */
export function qrDataToPayload(data: string): ExportPayload | null {
  try {
    const compact = JSON.parse(base64ToUtf8(data))
    return {
      version: compact.v,
      exportedAt: new Date().toISOString(),
      template: {
        name: compact.t.n,
        description: compact.t.d ?? null,
        cover_emoji: compact.t.e ?? null,
      },
      exercises: (compact.x ?? []).map((ex: any) => ({
        exercise_name: ex.n,
        exercise_movement: ex.m,
        order_num: ex.o,
        sets_planned: ex.s ?? null,
        reps_planned: ex.r ?? null,
        rpe_target: null,
        rest_seconds: ex.rs ?? 120,
        set_scheme: null,
        notes: null,
        tempo: null,
        superset_group: null,
      })),
      groups: [],
    }
  } catch {
    return null
  }
}
