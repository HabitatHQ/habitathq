import { describe, expect, it } from 'vitest'
import { MIGRATION_V7_SQL } from '~/lib/migrations/v7-multi-currency'

describe('Migration v7 — multi-currency schema', () => {
  it('exports an array of SQL statements', () => {
    expect(Array.isArray(MIGRATION_V7_SQL)).toBe(true)
    expect(MIGRATION_V7_SQL.length).toBeGreaterThan(0)
  })

  it('adds home_amount column to transactions', () => {
    const combined = MIGRATION_V7_SQL.join('\n')
    expect(combined).toContain('ALTER TABLE transactions ADD COLUMN home_amount REAL')
  })

  it('adds exchange_rate column to transactions', () => {
    const combined = MIGRATION_V7_SQL.join('\n')
    expect(combined).toContain('ALTER TABLE transactions ADD COLUMN exchange_rate REAL')
  })

  it('creates exchange_rates table with composite primary key', () => {
    const combined = MIGRATION_V7_SQL.join('\n')
    expect(combined).toContain('CREATE TABLE IF NOT EXISTS exchange_rates')
    expect(combined).toContain('base')
    expect(combined).toContain('target')
    expect(combined).toMatch(/rate\s+REAL\s+NOT\s+NULL/)
    expect(combined).toMatch(/PRIMARY KEY\(base, target, date\)/)
  })
})
