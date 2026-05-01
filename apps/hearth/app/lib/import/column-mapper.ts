export type HearthField =
  | 'date'
  | 'amount'
  | 'merchant'
  | 'category'
  | 'description'
  | 'account'
  | 'type'
  | 'skip'

const KNOWN_MAPPINGS: Record<string, HearthField> = {
  date: 'date',
  transaction_date: 'date',
  trans_date: 'date',
  amount: 'amount',
  outflow: 'amount',
  inflow: 'amount',
  debit: 'amount',
  credit: 'amount',
  payee: 'merchant',
  merchant: 'merchant',
  description: 'description',
  memo: 'description',
  notes: 'description',
  'original description': 'description',
  category: 'category',
  'category group/category': 'category',
  account: 'account',
  'account name': 'account',
  type: 'type',
  'transaction type': 'type',
}

/**
 * Auto-suggest Hearth field mappings based on CSV column header names.
 * Returns a Map of column name → HearthField.
 */
export function autoMapColumns(headers: string[]): Map<string, HearthField> {
  const result = new Map<string, HearthField>()
  const usedFields = new Set<HearthField>()

  for (const header of headers) {
    const normalized = header.toLowerCase().trim()
    const match = KNOWN_MAPPINGS[normalized]
    if (match && !usedFields.has(match)) {
      result.set(header, match)
      usedFields.add(match)
    }
  }

  return result
}
