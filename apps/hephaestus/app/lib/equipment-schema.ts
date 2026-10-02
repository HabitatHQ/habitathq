export const EQUIPMENT_DDL = `
CREATE TABLE IF NOT EXISTS equipment_profiles (
  exercise_id TEXT PRIMARY KEY REFERENCES exercises(id) ON DELETE CASCADE,
  minimum_kg REAL NOT NULL CHECK (minimum_kg >= 0),
  increment_kg REAL NOT NULL CHECK (increment_kg > 0),
  maximum_kg REAL CHECK (maximum_kg IS NULL OR maximum_kg >= minimum_kg),
  additional_loads_kg TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
`
