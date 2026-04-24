import type { Confidence } from './types'

const STOP_WORDS = new Set([
  'at',
  'for',
  'on',
  'to',
  'from',
  'the',
  'a',
  'an',
  'and',
  'or',
  'in',
  'of',
  'with',
  'my',
  'some',
])

export interface MerchantResult {
  merchant: string
  confidence: Confidence
}

export function parseMerchant(
  text: string,
  amountMatch: string | null,
  dateMatch: string | null,
  typeKeywords: string[],
): MerchantResult {
  let remaining = text

  // Remove matched segments
  if (amountMatch) remaining = remaining.replace(amountMatch, ' ')
  if (dateMatch) remaining = remaining.replace(dateMatch, ' ')
  for (const kw of typeKeywords) {
    remaining = remaining.replace(new RegExp(`\\b${kw}\\b`, 'gi'), ' ')
  }

  // Remove dollar sign leftovers
  remaining = remaining.replace(/\$/g, ' ')

  // Remove stop words at boundaries
  const words = remaining.split(/\s+/).filter((w) => {
    const lower = w.toLowerCase().replace(/[.,!?]/g, '')
    return lower.length > 0 && !STOP_WORDS.has(lower)
  })

  const merchant = words.join(' ').trim()

  if (!merchant) {
    return { merchant: '', confidence: 'low' }
  }

  return { merchant, confidence: 'medium' }
}
