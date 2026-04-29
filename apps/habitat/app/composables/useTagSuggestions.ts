import type { TagRow, TagSource } from '~/types/database'
import { isReservedTag } from '~/utils/tags'

export interface RankedTag {
  tag: string
  score: number
}

const DEFAULT_TAGS: Record<TagSource, string[]> = {
  todo: [
    'deep-work',
    'errand',
    'quick-win',
    'waiting-on',
    'someday-maybe',
    'before-bed',
    'this-week',
    'money',
    'prep',
    'declutter',
  ],
  habit: [
    'morning-ritual',
    'wind-down',
    'movement',
    'focus',
    'fuel',
    'connect',
    'rest',
    'growth',
    'outdoors',
    'creative',
  ],
  scribble: [
    'spark',
    'brain-dump',
    'how-to',
    'gratitude',
    'lesson-learned',
    'book-note',
    'shower-thought',
    'dream',
    'rant',
    'pep-talk',
  ],
  bored: [
    'no-screen',
    'under-10min',
    'rainy-day',
    'with-friends',
    'solo-quest',
    'hands-on',
    'brain-off',
    'fresh-air',
  ],
}

function isCandidate(tag: string, prefix: string, excluded: Set<string>): boolean {
  if (isReservedTag(tag) || excluded.has(tag)) return false
  return !prefix || tag.toLowerCase().startsWith(prefix)
}

function buildScoreMap(
  rows: TagRow[],
  context: TagSource,
  prefix: string,
  excluded: Set<string>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!isCandidate(r.tag, prefix, excluded)) continue
    const prev = map.get(r.tag) ?? 0
    const weight = r.source === context ? 3 : 1
    map.set(r.tag, prev + r.count * weight)
  }
  return map
}

/**
 * Pure scoring function (exported for testing).
 * Ranks tags by relevance to the given context, filters reserved tags,
 * and supports bonus suggestions (e.g. bored category names).
 * When the user has few tags, smart defaults for the context are mixed in.
 */
export function rankSuggestions(
  rows: TagRow[],
  context: TagSource,
  input: string,
  alreadySelected: string[],
  maxResults: number = 8,
  bonusSuggestions: string[] = [],
): RankedTag[] {
  const prefix = input.toLowerCase()
  const excluded = new Set(alreadySelected)
  const scoreMap = buildScoreMap(rows, context, prefix, excluded)

  for (const bonus of bonusSuggestions) {
    if (isCandidate(bonus, prefix, excluded) && !scoreMap.has(bonus)) {
      scoreMap.set(bonus, 0.5)
    }
  }

  const defaults = DEFAULT_TAGS[context] ?? []
  for (const d of defaults) {
    if (isCandidate(d, prefix, excluded) && !scoreMap.has(d)) {
      scoreMap.set(d, 0.1)
    }
  }

  const results: RankedTag[] = Array.from(scoreMap, ([tag, score]) => ({ tag, score }))
  results.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
  return results.slice(0, maxResults)
}

/**
 * Composable that loads all tags from the DB once per session
 * and provides context-aware suggestions.
 */
export function useTagSuggestions(context: TagSource, bonusSuggestions?: Ref<string[]>) {
  const db = useDatabase()
  const tagRows = useState<TagRow[]>('all-tag-rows', () => [])
  const loaded = useState<boolean>('all-tag-rows-loaded', () => false)

  async function loadTags() {
    if (loaded.value) return
    tagRows.value = await db.getAllTags()
    loaded.value = true
  }

  function suggest(input: string, alreadySelected: string[]): RankedTag[] {
    return rankSuggestions(
      tagRows.value,
      context,
      input,
      alreadySelected,
      8,
      bonusSuggestions?.value ?? [],
    )
  }

  const allUserTags = computed(() => {
    const seen = new Set<string>()
    for (const r of tagRows.value) {
      if (!isReservedTag(r.tag)) seen.add(r.tag)
    }
    return [...seen].sort()
  })

  return { loadTags, suggest, allUserTags, tagRows: readonly(tagRows) }
}
