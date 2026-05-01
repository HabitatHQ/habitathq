import type { Confidence } from './types'

// ── Symbol-prefixed amounts ───────────────────────────────────────────────
const USD_RE = /\$\s?(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/
const EUR_RE = /€\s?(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/
const GBP_RE = /£\s?(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/
const YEN_RE = /¥\s?(\d{1,9}(?:,\d{3})*)/

// ── Word/code-suffixed amounts ────────────────────────────────────────────
const AMOUNT_WORDS_RE =
  /(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|bucks?|usd|euros?|eur|pounds?|gbp|yen|jpy|cad|aud)/i

const CURRENCY_WORD_MAP: Record<string, string> = {
  dollar: 'USD',
  dollars: 'USD',
  buck: 'USD',
  bucks: 'USD',
  usd: 'USD',
  euro: 'EUR',
  euros: 'EUR',
  eur: 'EUR',
  pound: 'GBP',
  pounds: 'GBP',
  gbp: 'GBP',
  yen: 'JPY',
  jpy: 'JPY',
  cad: 'CAD',
  aud: 'AUD',
}

// ── Bare number ───────────────────────────────────────────────────────────
const BARE_NUMBER_RE = /(?:^|\s)(\d{1,7}(?:\.\d{1,2})?)(?:\s|$)/

// ── Written numbers ───────────────────────────────────────────────────────
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
  currency?: string
}

export function parseAmount(text: string): AmountResult | null {
  // 1. €50 style
  const eurMatch = EUR_RE.exec(text)
  if (eurMatch?.[1]) {
    return {
      amount: parseFloat(eurMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: eurMatch[0],
      currency: 'EUR',
    }
  }

  // 2. £12.50 style
  const gbpMatch = GBP_RE.exec(text)
  if (gbpMatch?.[1]) {
    return {
      amount: parseFloat(gbpMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: gbpMatch[0],
      currency: 'GBP',
    }
  }

  // 3. ¥3000 style
  const yenMatch = YEN_RE.exec(text)
  if (yenMatch?.[1]) {
    return {
      amount: parseFloat(yenMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: yenMatch[0],
      currency: 'JPY',
    }
  }

  // 4. $12.50 style
  const usdMatch = USD_RE.exec(text)
  if (usdMatch?.[1]) {
    return {
      amount: parseFloat(usdMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: usdMatch[0],
      currency: 'USD',
    }
  }

  // 5. "12.50 dollars/euros/GBP" style
  const wordMatch = AMOUNT_WORDS_RE.exec(text)
  if (wordMatch?.[1]) {
    const word = wordMatch[0].replace(wordMatch[1], '').trim().toLowerCase()
    const currency = CURRENCY_WORD_MAP[word]
    return {
      amount: parseFloat(wordMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matchedText: wordMatch[0],
      currency,
    }
  }

  // 6. Written numbers: "five dollars", "twenty bucks"
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

  // 7. Bare number (lowest confidence — no currency detected)
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
