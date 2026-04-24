import type { TransactionType } from '~/types/database'
import type { Confidence, ParserContext } from './types'

/** Known merchant name → category ID */
const MERCHANT_CATEGORY_HINTS: Record<string, string> = {
  // Groceries (c1a)
  'whole foods': 'c1a',
  'trader joe': 'c1a',
  safeway: 'c1a',
  costco: 'c1a',
  kroger: 'c1a',
  walmart: 'c1a',
  aldi: 'c1a',
  target: 'c1a',
  // Dining (c1b)
  restaurant: 'c1b',
  doordash: 'c1b',
  'uber eats': 'c1b',
  grubhub: 'c1b',
  chipotle: 'c1b',
  mcdonald: 'c1b',
  subway: 'c1b',
  sweetgreen: 'c1b',
  // Coffee (c1c)
  starbucks: 'c1c',
  'blue bottle': 'c1c',
  philz: 'c1c',
  dunkin: 'c1c',
  peet: 'c1c',
  // Gas (c2a)
  shell: 'c2a',
  chevron: 'c2a',
  bp: 'c2a',
  exxon: 'c2a',
  mobil: 'c2a',
  // Parking (c2b)
  parking: 'c2b',
  parkwhiz: 'c2b',
  // Transit (c2c)
  uber: 'c2c',
  lyft: 'c2c',
  metro: 'c2c',
  // Internet (c3a)
  comcast: 'c3a',
  xfinity: 'c3a',
  spectrum: 'c3a',
  // Phone (c3b)
  't-mobile': 'c3b',
  'at&t': 'c3b',
  verizon: 'c3b',
  // Utilities (c3c)
  'pg&e': 'c3c',
  electric: 'c3c',
  // Rent (c3d)
  rent: 'c3d',
  mortgage: 'c3d',
  // Amazon (c4a)
  amazon: 'c4a',
  // Clothing (c4b)
  zara: 'c4b',
  'h&m': 'c4b',
  uniqlo: 'c4b',
  gap: 'c4b',
  // Pharmacy (c5a)
  cvs: 'c5a',
  walgreens: 'c5a',
  // Gym (c5b)
  gym: 'c5b',
  equinox: 'c5b',
  'planet fitness': 'c5b',
  // Streaming (c6a)
  netflix: 'c6a',
  spotify: 'c6a',
  hbo: 'c6a',
  'disney+': 'c6a',
  hulu: 'c6a',
  // Games (c6b)
  steam: 'c6b',
  playstation: 'c6b',
  xbox: 'c6b',
  nintendo: 'c6b',
  // Salary (c7a)
  salary: 'c7a',
  paycheck: 'c7a',
  // Freelance (c7b)
  freelance: 'c7b',
  invoice: 'c7b',
}

/** Text keyword → category ID */
const TEXT_CATEGORY_HINTS: Record<string, string> = {
  grocery: 'c1a',
  groceries: 'c1a',
  lunch: 'c1b',
  dinner: 'c1b',
  breakfast: 'c1b',
  dining: 'c1b',
  food: 'c1',
  coffee: 'c1c',
  latte: 'c1c',
  cappuccino: 'c1c',
  gas: 'c2a',
  fuel: 'c2a',
  petrol: 'c2a',
  parking: 'c2b',
  taxi: 'c2c',
  bus: 'c2c',
  train: 'c2c',
  transit: 'c2c',
  internet: 'c3a',
  wifi: 'c3a',
  phone: 'c3b',
  electric: 'c3c',
  utility: 'c3c',
  utilities: 'c3c',
  rent: 'c3d',
  mortgage: 'c3d',
  clothes: 'c4b',
  clothing: 'c4b',
  shoes: 'c4b',
  medicine: 'c5a',
  pharmacy: 'c5a',
  prescription: 'c5a',
  gym: 'c5b',
  fitness: 'c5b',
  workout: 'c5b',
  movie: 'c6a',
  movies: 'c6a',
  streaming: 'c6a',
  game: 'c6b',
  games: 'c6b',
}

export interface CategoryResult {
  categoryId: string | null
  confidence: Confidence
}

export function parseCategory(
  merchant: string,
  text: string,
  type: TransactionType,
  context: ParserContext,
): CategoryResult {
  const merchantLower = merchant.toLowerCase().trim()
  const textLower = text.toLowerCase()

  // 1. Learned merchant mapping (highest priority)
  const mapping = context.merchantMappings.get(merchantLower)
  if (mapping) {
    return { categoryId: mapping.category_id, confidence: 'high' }
  }

  // 2. Hardcoded merchant hints (partial match)
  for (const [hint, catId] of Object.entries(MERCHANT_CATEGORY_HINTS)) {
    if (merchantLower.includes(hint) || hint.includes(merchantLower)) {
      return { categoryId: catId, confidence: 'medium' }
    }
  }

  // 3. Text keyword scan
  for (const [keyword, catId] of Object.entries(TEXT_CATEGORY_HINTS)) {
    if (textLower.includes(keyword)) {
      return { categoryId: catId, confidence: 'medium' }
    }
  }

  // 4. Type defaults
  if (type === 'income') {
    return { categoryId: 'c7', confidence: 'low' }
  }

  return { categoryId: null, confidence: 'low' }
}
