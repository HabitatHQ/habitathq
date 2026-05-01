import { describe, expect, it } from 'vitest'
import { autoMapCategories } from '~/lib/import/category-mapper'
import { autoMapColumns } from '~/lib/import/column-mapper'
import { detectDelimiter, parseCSV } from '~/lib/import/csv-parser'
import { findDuplicates } from '~/lib/import/dedup'

describe('parseCSV', () => {
  it('parses comma-delimited CSV', () => {
    const text = 'Date,Amount,Name\n2026-01-01,50.00,Grocery'
    const result = parseCSV(text)
    expect(result.headers).toEqual(['Date', 'Amount', 'Name'])
    expect(result.rows).toEqual([['2026-01-01', '50.00', 'Grocery']])
  })

  it('handles quoted fields', () => {
    const text = 'Name,Amount\n"Whole Foods, Inc.",87.50'
    const result = parseCSV(text)
    expect(result.rows[0]![0]).toBe('Whole Foods, Inc.')
  })

  it('handles escaped quotes', () => {
    const text = 'Name\n"She said ""hello"""'
    const result = parseCSV(text)
    expect(result.rows[0]![0]).toBe('She said "hello"')
  })

  it('handles CRLF line endings', () => {
    const text = 'A,B\r\n1,2\r\n3,4'
    const result = parseCSV(text)
    expect(result.rows.length).toBe(2)
  })

  it('strips BOM', () => {
    const text = '\uFEFFDate,Amount\n2026-01-01,10'
    const result = parseCSV(text)
    expect(result.headers[0]).toBe('Date')
  })

  it('parses semicolon-delimited CSV', () => {
    const text = 'Date;Amount;Name\n2026-01-01;50.00;Grocery'
    const result = parseCSV(text)
    expect(result.headers).toEqual(['Date', 'Amount', 'Name'])
    expect(result.rows[0]![2]).toBe('Grocery')
  })

  it('parses tab-delimited CSV', () => {
    const text = 'Date\tAmount\tName\n2026-01-01\t50.00\tGrocery'
    const result = parseCSV(text)
    expect(result.headers).toEqual(['Date', 'Amount', 'Name'])
  })
})

describe('detectDelimiter', () => {
  it('detects comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
  })
  it('detects semicolon', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })
  it('detects tab', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })
})

describe('autoMapColumns', () => {
  it('maps common column names', () => {
    const mapping = autoMapColumns(['Date', 'Payee', 'Amount', 'Category', 'Notes'])
    expect(mapping.get('Date')).toBe('date')
    expect(mapping.get('Payee')).toBe('merchant')
    expect(mapping.get('Amount')).toBe('amount')
    expect(mapping.get('Category')).toBe('category')
    expect(mapping.get('Notes')).toBe('description')
  })

  it('handles case-insensitive matches', () => {
    const mapping = autoMapColumns(['DATE', 'payee', 'AMOUNT'])
    expect(mapping.get('DATE')).toBe('date')
    expect(mapping.get('payee')).toBe('merchant')
  })

  it('maps YNAB-specific columns', () => {
    const mapping = autoMapColumns([
      'Date',
      'Payee',
      'Category Group/Category',
      'Memo',
      'Outflow',
      'Inflow',
    ])
    expect(mapping.get('Outflow')).toBe('amount')
    expect(mapping.get('Memo')).toBe('description')
  })
})

describe('autoMapCategories', () => {
  const hearthCategories = [
    { id: 'c1a', name: 'Groceries' },
    { id: 'c1b', name: 'Dining Out' },
    { id: 'c2a', name: 'Gas' },
    { id: 'c3a', name: 'Internet' },
  ]

  it('exact match (case-insensitive)', () => {
    const result = autoMapCategories(['groceries'], hearthCategories)
    expect(result.get('groceries')?.hearthId).toBe('c1a')
  })

  it('substring match for YNAB-style categories', () => {
    const result = autoMapCategories(['Food: Groceries'], hearthCategories)
    expect(result.get('Food: Groceries')?.hearthId).toBe('c1a')
  })

  it('marks unmatched categories for creation', () => {
    const result = autoMapCategories(['Pet Supplies'], hearthCategories)
    expect(result.get('Pet Supplies')?.action).toBe('create')
  })
})

describe('findDuplicates', () => {
  it('detects exact match on date + amount + merchant', () => {
    const incoming = [
      { date: '2026-01-01', amount: -50, merchant: 'Whole Foods' },
      { date: '2026-01-02', amount: -30, merchant: 'Starbucks' },
    ]
    const existing = [{ date: '2026-01-01', amount: -50, merchant: 'whole foods' }]
    const dupes = findDuplicates(incoming, existing)
    expect(dupes.has(0)).toBe(true)
    expect(dupes.has(1)).toBe(false)
  })

  it('does not flag near-misses', () => {
    const incoming = [{ date: '2026-01-01', amount: -50, merchant: 'Whole Foods' }]
    const existing = [{ date: '2026-01-01', amount: -55, merchant: 'Whole Foods' }]
    const dupes = findDuplicates(incoming, existing)
    expect(dupes.has(0)).toBe(false)
  })
})
