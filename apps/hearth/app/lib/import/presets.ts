import type { HearthField } from './column-mapper'

export interface ImportPreset {
  name: string
  columnMap: Record<string, HearthField>
  dateFormat: string // 'M/D/YYYY' | 'YYYY-MM-DD'
  amountRules: {
    /** If true, amount is always positive and type determines sign */
    alwaysPositive: boolean
    /** Column name for outflow (expense) — YNAB style */
    outflowColumn?: string
    /** Column name for inflow (income) — YNAB style */
    inflowColumn?: string
    /** Column name for transaction type — Mint style */
    typeColumn?: string
    /** Value in typeColumn that indicates expense */
    expenseValue?: string
  }
}

export const YNAB_PRESET: ImportPreset = {
  name: 'YNAB',
  columnMap: {
    Date: 'date',
    Payee: 'merchant',
    'Category Group/Category': 'category',
    Memo: 'description',
    Outflow: 'amount',
    Account: 'account',
  },
  dateFormat: 'M/D/YYYY',
  amountRules: {
    alwaysPositive: true,
    outflowColumn: 'Outflow',
    inflowColumn: 'Inflow',
  },
}

export const MINT_PRESET: ImportPreset = {
  name: 'Mint',
  columnMap: {
    Date: 'date',
    Description: 'merchant',
    'Original Description': 'description',
    Amount: 'amount',
    Category: 'category',
    'Account Name': 'account',
  },
  dateFormat: 'M/D/YYYY',
  amountRules: {
    alwaysPositive: true,
    typeColumn: 'Transaction Type',
    expenseValue: 'debit',
  },
}
