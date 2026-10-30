import { structuralFingerprint } from '~/lib/prescription-domain'
import type { ProgramDesign } from '~/types/prescription'

/**
 * Canonical Program revision structure fingerprint.
 *
 * Program revision creation, portable import and the identity migration must all
 * hash a design the same way, otherwise a remapped design would fail the
 * revision consistency check the app performs on load.
 */
export function programStructureHash(design: ProgramDesign): string {
  return structuralFingerprint({
    schemaVersion: 1,
    evaluatorVersion: 'program-v1',
    inputs: [],
    defaults: { incrementKg: 1, restSec: 0 },
    groups: [],
    activities: design.slots.map((slot, index) => ({
      id: slot.id,
      exerciseId: slot.templateId ?? '',
      order: index + 1,
      loggingMode: 'strength',
      executionGroupId: null,
      sets: [],
      targets: { durationSec: null, distanceM: null },
      notes: null,
    })),
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
  })
}
