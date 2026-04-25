/** Migration v7: Multi-currency support */
export const MIGRATION_V7_SQL = [
  'ALTER TABLE transactions ADD COLUMN home_amount REAL',
  'ALTER TABLE transactions ADD COLUMN exchange_rate REAL',
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    base   TEXT NOT NULL,
    target TEXT NOT NULL,
    rate   REAL NOT NULL,
    date   TEXT NOT NULL,
    PRIMARY KEY(base, target, date)
  )`,
]
