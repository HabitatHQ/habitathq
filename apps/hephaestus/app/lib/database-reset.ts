import { resetOwnedTables } from '@palladium/core'
import type { DbAdapter } from '~/types/database'

export const HEPHAESTUS_OWNED_TABLES = [
  'exercises',
  'templates',
  'template_exercises',
  'template_groups',
  'programs',
  'program_weeks',
  'program_days',
  'training_blocks',
  'workouts',
  'workout_exercises',
  'sets',
  'runs',
  'run_splits',
  'interval_templates',
  'body_weights',
  'body_measurements',
  'body_photos',
  'personal_records',
  'weekly_training_load',
  'tags',
  'workout_tags',
  'template_folders',
  'template_folder_items',
  'template_tags',
  'applied_defaults',
  'equipment_profiles',
  'workout_finish_summaries',
  'workout_session_options',
  'template_revisions',
  'saved_routines',
  'routine_revisions',
  'program_revisions',
  'training_plans',
  'training_plan_bindings',
  'workout_intents',
  'workout_intent_activities',
  'workout_intent_sets',
  'workout_set_skips',
  'prescription_previews',
  'history_correction_previews',
  'history_corrections',
  'routine_update_previews',
  'organization_appointments',
  'organization_recurrence_rules',
  'organization_rotations',
  'organization_rotation_advances',
  'organization_goals',
  'organization_goal_credits',
  'organization_reviews',
  'organization_source_links',
] as const

export async function resetDatabase(db: DbAdapter): Promise<void> {
  await resetOwnedTables(
    {
      transaction: (run) =>
        db.transaction((tx) =>
          run({
            exec: (sql, bind) => tx.exec(sql, bind),
            deferForeignKeys: () => tx.exec('PRAGMA defer_foreign_keys = ON'),
          }),
        ),
    },
    { ownedTables: [...HEPHAESTUS_OWNED_TABLES] },
  )
}
