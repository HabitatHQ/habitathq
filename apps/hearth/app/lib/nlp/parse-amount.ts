import type { Confidence } from './types'

const CURRENCY_RE = /\$\s?(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/
const AMOUNT_DOLLARS_RE = /(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|bucks?|usd)/i
const BARE_NUMBER_RE = /(?:^|\s)(\d{1,7}(?:\.\d{1,2})?)(?:\s|$)/

const WRITTEN_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
}
const WRITTEN_RE = new RegExp(
  `\\b(${Object.keys(WRITTEN_NUMBERS).join('|')})\\s*(?:dollars?|bucks?)?\\b`,
  'i',
)

export interface AmountResult {
  amount: number
  confidence: Confidence
  matchedText: string
}

export function parseAmount(text: string): AmountResult | null {
  // 1. $12.50 style (highest confidence)
  const currencyMatch = CURRENCY_RE.exec(text)
  if (currencyMatch?.[1]) {
    return {
      amount: parseFloat(currencyMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: currencyMatch[0],
    }
  }

  // 2. "12.50 dollars" style
  const dollarMatch = AMOUNT_DOLLARS_RE.exec(text)
  if (dollarMatch?.[1]) {
    return {
      amount: parseFloat(dollarMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: dollarMatch[0],
    }
  }

  // 3. Written numbers: "five dollars", "twenty bucks"
  const writtenMatch = WRITTEN_RE.exec(text)
  if (writtenMatch?.[1]) {
    const num = WRITTEN_NUMBERS[writtenMatch[1].toLowerCase()]
    if (num !== undefined) {
      return {
        amount: num,
        confidence: 'medium',
        matchedText: writtenMatch[0],
      }
    }
  }

  // 4. Bare number (lowest confidence — only if it looks reasonable as an amount)
  const bareMatch = BARE_NUMBER_RE.exec(text)
  if (bareMatch?.[1]) {
    const val = parseFloat(bareMatch[1])
    if (val > 0 && val < 100000) {
      return {
        amount: val,
        confidence: 'low',
        matchedText: bareMatch[0].trim(),
      }
    }
  }

  return null
}
