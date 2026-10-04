import type { HearthExport } from '~/types/database'

type UnknownRecord = Record<string, unknown>

const USER_ROLES = ['owner', 'partner', 'family', 'child'] as const
const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash'] as const
const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const
const TRANSACTION_SOURCES = ['manual', 'import', 'voice', 'ocr'] as const
const BUDGET_PERIODS = ['monthly', 'weekly', 'yearly'] as const
const ENVELOPE_SCOPES = ['personal', 'household'] as const
const CHORE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(record: UnknownRecord, key: string): boolean {
  return typeof record[key] === 'string'
}

function isNullableString(record: UnknownRecord, key: string): boolean {
  return record[key] === null || typeof record[key] === 'string'
}

function isFiniteNumber(record: UnknownRecord, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

function isOptionalFiniteNumber(record: UnknownRecord, key: string): boolean {
  return record[key] === undefined || record[key] === null || isFiniteNumber(record, key)
}

function isFlag(record: UnknownRecord, key: string): boolean {
  return record[key] === 0 || record[key] === 1
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
}

function isStringArrayJson(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
  } catch {
    return false
  }
}

function isUser(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isString(value, 'id') &&
    isString(value, 'name') &&
    isNullableString(value, 'email') &&
    isOneOf(value['role'], USER_ROLES) &&
    isString(value, 'avatar_emoji') &&
    isString(value, 'color') &&
    isFlag(value, 'is_current') &&
    isString(value, 'created_at')
  )
}

function isAccount(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isString(value, 'id') &&
    isString(value, 'user_id') &&
    isString(value, 'name') &&
    isOneOf(value['type'], ACCOUNT_TYPES) &&
    isFiniteNumber(value, 'balance') &&
    (value['opening_balance'] === undefined || isFiniteNumber(value, 'opening_balance')) &&
    isString(value, 'currency') &&
    isString(value, 'color') &&
    isString(value, 'icon') &&
    isFlag(value, 'is_active') &&
    isString(value, 'created_at')
  )
}

function isCategory(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isString(value, 'id') &&
    isNullableString(value, 'parent_id') &&
    isString(value, 'name') &&
    isString(value, 'icon') &&
    isString(value, 'color') &&
    isFiniteNumber(value, 'sort_order')
  )
}

function isTransaction(value: unknown): boolean {
  if (!isRecord(value)) return false
  const source = value['source']
  return (
    isString(value, 'id') &&
    isString(value, 'date') &&
    isFiniteNumber(value, 'amount') &&
    isString(value, 'currency') &&
    isNullableString(value, 'account_id') &&
    isNullableString(value, 'user_id') &&
    isOneOf(value['type'], TRANSACTION_TYPES) &&
    isNullableString(value, 'category_id') &&
    isString(value, 'description') &&
    isString(value, 'merchant') &&
    isFlag(value, 'is_private') &&
    isFlag(value, 'is_recurring') &&
    isNullableString(value, 'transfer_to_account_id') &&
    isNullableString(value, 'split_id') &&
    isString(value, 'created_at') &&
    isString(value, 'updated_at') &&
    (source === undefined || isOneOf(source, TRANSACTION_SOURCES)) &&
    isOptionalFiniteNumber(value, 'home_amount') &&
    isOptionalFiniteNumber(value, 'exchange_rate')
  )
}

function isEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isString(value, 'id') &&
    isString(value, 'name') &&
    isString(value, 'icon') &&
    isString(value, 'color') &&
    isFiniteNumber(value, 'budget_amount') &&
    isOneOf(value['period'], BUDGET_PERIODS) &&
    isOneOf(value['scope'], ENVELOPE_SCOPES) &&
    isStringArrayJson(value['category_ids']) &&
    isFlag(value, 'rollover') &&
    isString(value, 'created_at')
  )
}

function isEnvelopePeriod(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value, 'id') &&
    isString(value, 'envelope_id') &&
    isString(value, 'period') &&
    isFiniteNumber(value, 'spent') &&
    isFiniteNumber(value, 'rolled_over')
  )
}

function isIouSplit(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value, 'id') &&
    isNullableString(value, 'transaction_id') &&
    isString(value, 'from_user_id') &&
    isString(value, 'to_user_id') &&
    isFiniteNumber(value, 'amount') &&
    isFlag(value, 'is_settled') &&
    isNullableString(value, 'settled_at') &&
    isString(value, 'created_at')
  )
}

function isSavingsGoal(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value, 'id') &&
    isString(value, 'name') &&
    isString(value, 'icon') &&
    isString(value, 'color') &&
    isFiniteNumber(value, 'target_amount') &&
    isFiniteNumber(value, 'current_amount') &&
    isNullableString(value, 'target_date') &&
    isOneOf(value['scope'], ENVELOPE_SCOPES) &&
    isString(value, 'created_at')
  )
}

function isChore(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value, 'id') &&
    isString(value, 'name') &&
    isString(value, 'icon') &&
    isString(value, 'color') &&
    isOneOf(value['frequency'], CHORE_FREQUENCIES) &&
    isOneOf(value['scope'], ENVELOPE_SCOPES) &&
    isNullableString(value, 'assigned_to') &&
    isString(value, 'created_at')
  )
}

function isArrayOf(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(predicate)
}

/** Validate the persisted Hearth v1 JSON boundary before any database mutation. */
export function isHearthExport(value: unknown): value is HearthExport {
  if (!isRecord(value)) return false
  return (
    value['version'] === '1.0' &&
    isString(value, 'exported_at') &&
    isArrayOf(value['users'], isUser) &&
    isArrayOf(value['accounts'], isAccount) &&
    isArrayOf(value['categories'], isCategory) &&
    isArrayOf(value['transactions'], isTransaction) &&
    isArrayOf(value['envelopes'], isEnvelope) &&
    isArrayOf(value['envelope_periods'], isEnvelopePeriod) &&
    isArrayOf(value['iou_splits'], isIouSplit) &&
    isArrayOf(value['savings_goals'], isSavingsGoal) &&
    isArrayOf(value['chores'], isChore)
  )
}

export function parseHearthExport(value: unknown): HearthExport {
  if (isRecord(value) && value['version'] !== '1.0') {
    throw new Error(`Unsupported Hearth export version: ${String(value['version'])}`)
  }
  if (!isHearthExport(value)) {
    throw new Error('Invalid Hearth export: required data is missing or malformed')
  }
  return value
}
