const AMOUNT_RE = /\$?\d{1,3}(?:,\d{3})*\.\d{2}/g

function extractAmounts(line: string): number[] {
  const matches = line.match(AMOUNT_RE) ?? []
  return matches.map((m) => Number.parseFloat(m.replace(/[$,]/g, '')))
}

/** Extract total amount from receipt lines */
export function extractTotal(lines: string[]): number | null {
  // Priority 1: Line containing "TOTAL" (not "SUBTOTAL", not "TAX")
  for (const line of lines) {
    const upper = line.toUpperCase()
    if (upper.includes('SUBTOTAL') || upper.includes('TAX')) continue
    if (
      upper.includes('TOTAL') ||
      upper.includes('AMOUNT DUE') ||
      upper.includes('BALANCE DUE') ||
      upper.includes('GRAND TOTAL')
    ) {
      const amounts = extractAmounts(line)
      if (amounts.length) return amounts[amounts.length - 1]!
    }
  }

  // Fallback: largest dollar amount on the receipt
  let largest: number | null = null
  for (const line of lines) {
    for (const amount of extractAmounts(line)) {
      if (largest === null || amount > largest) largest = amount
    }
  }
  return largest
}

/** Extract date from receipt lines */
export function extractDate(lines: string[]): string | null {
  for (const line of lines) {
    // MM/DD/YYYY
    const mdy = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (mdy) {
      return `${mdy[3]}-${mdy[1]!.padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`
    }
    // YYYY-MM-DD
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
      return iso[0]
    }
  }
  return null
}

/** Check if a line looks like an address or phone number */
function isAddressOrPhone(line: string): boolean {
  // Phone pattern
  if (/\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/.test(line)) return true
  // Address pattern: starts with number
  if (/^\d+\s+(N|S|E|W|North|South|East|West|Main|Oak|Elm|St|Ave|Rd|Blvd|Dr|Ln|Way)/i.test(line))
    return true
  // Short lines or URL-like
  if (line.includes('www.') || line.includes('.com')) return true
  return false
}

/** Extract merchant name from receipt header lines */
export function extractMerchant(lines: string[]): string | null {
  // Look at first few lines, skip addresses and phone numbers
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 3) continue
    if (isAddressOrPhone(trimmed)) continue
    // Skip lines that are just numbers or amounts
    if (/^\$?\d/.test(trimmed)) continue
    return trimmed
  }
  return null
}

/** Full receipt parsing pipeline */
export interface ParsedReceipt {
  total: number | null
  date: string | null
  merchant: string | null
}

export function parseReceipt(ocrText: string): ParsedReceipt {
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return {
    total: extractTotal(lines),
    date: extractDate(lines),
    merchant: extractMerchant(lines),
  }
}
