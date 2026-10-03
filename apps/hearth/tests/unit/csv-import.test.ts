import { describe, expect, it } from 'vitest'
import { autoMapCategories } from '~/lib/import/category-mapper'
import { autoMapColumns } from '~/lib/import/column-mapper'
import { detectDelimiter, parseCSV } from '~/lib/import/csv-parser'
import { findDuplicates } from '~/lib/import/dedup'
import { buildImportRecord } from '~/lib/import/record-builder'
import { parseImportAmount, parseImportDate } from '~/lib/import/parsers'

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

describe('parseCSV source row indices', () => {
  it('keeps original line numbers when blank rows are omitted', () => {
    const parsed = parseCSV('Date,Amount\n2026-01-01,1\n\n2026-01-02,2')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rowIndices).toEqual([2, 4])
  })
})

describe('parseImportAmount', () => {
  it.each([
    ['$1,234.50', 1234.5],
    ['$12.50', 12.5],
    ['12.50€', 12.5],
    ['(€25.00)', -25],
    ['-12.5', -12.5],
    [' 50 ', 50],
  ])('parses supported amount %s', (raw, expected) => {
    expect(parseImportAmount(raw)).toBe(expected)
  })

  it.each(['12abc', '1$2', 'Infinity', '-Infinity', 'NaN', '1,23.00', '1e3', '$'])(
    'rejects invalid amount %s',
    (raw) => {
      expect(parseImportAmount(raw)).toBeNull()
    },
  )
})

describe('parseImportDate', () => {
  it.each([
    ['2024-02-29', '2024-02-29'],
    ['2/9/2024', '2024-02-09'],
    ['2/9/51', '1951-02-09'],
    ['2/9/50', '2050-02-09'],
  ])('parses documented date %s', (raw, expected) => {
    expect(parseImportDate(raw)).toBe(expected)
  })

  it.each(['2023-02-29', '2/30/2024', '13/1/2024', '1/0/2024', '2024-1-01'])(
    'rejects invalid or unsupported date %s',
    (raw) => {
      expect(parseImportDate(raw)).toBeNull()
    },
  )
})

describe('buildImportRecord', () => {
  const accounts = [
    { id: 'checking', name: 'Checking', currency: 'USD' },
    { id: 'euro', name: 'Euro Account', currency: 'EUR' },
  ]

  it('uses mapped account, type, and explicit CSV currency', () => {
    const result = buildImportRecord(
      {
        date: '2026-01-02',
        amount: '25',
        merchant: 'Market',
        description: '',
        category: '',
        account: 'Euro Account',
        type: 'expense',
        currency: 'GBP',
      },
      accounts,
      'checking',
      'USD',
      'user',
      null,
    )
    expect(result.record).toMatchObject({
      account_id: 'euro',
      amount: -25,
      type: 'expense',
      currency: 'GBP',
    })
  })

  it('uses the selected account currency when CSV currency is absent', () => {
    const result = buildImportRecord(
      {
        date: '2026-01-02',
        amount: '-25',
        merchant: 'Market',
        description: '',
        category: '',
        account: 'Euro Account',
        type: '',
        currency: '',
      },
      accounts,
      'checking',
      'USD',
      'user',
      null,
    )
    expect(result.record).toMatchObject({ account_id: 'euro', amount: -25, type: 'expense', currency: 'EUR' })
  })

  it('rejects unknown account, type, or unsupported explicit currency', () => {
    const fields = {
      date: '2026-01-02',
      amount: '25',
      merchant: '',
      description: '',
      category: '',
      account: 'Missing',
      type: '',
      currency: '',
    }
    expect(buildImportRecord(fields, accounts, 'checking', 'USD', 'user', null).reason).toContain(
      'Unknown account',
    )
    expect(
      buildImportRecord(
        { ...fields, account: '', type: 'transfer' },
        accounts,
        'checking',
        'USD',
        'user',
        null,
      ).reason,
    ).toContain('Unsupported transaction type')
    expect(
      buildImportRecord(
        { ...fields, account: '', currency: 'XYZ' },
        accounts,
        'checking',
        'USD',
        'user',
        null,
      ).reason,
    ).toContain('Unsupported currency')
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
  it('maps account, transaction type, and currency fields', () => {
    const mapping = autoMapColumns(['Account Name', 'Transaction Type', 'Currency Code'])
    expect(mapping.get('Account Name')).toBe('account')
    expect(mapping.get('Transaction Type')).toBe('type')
    expect(mapping.get('Currency Code')).toBe('currency')
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
