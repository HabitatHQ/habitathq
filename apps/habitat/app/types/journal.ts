export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night' | 'anytime'

export interface Prompt {
  id: string
  question: string
  /** Time slots when this prompt is shown by default. */
  when: TimeOfDay[]
  /** Hierarchical tag keys, e.g. 'wellbeing/gratitude'. */
  tags: string[]
  /** Arbitrary key-value metadata on the prompt definition. */
  annotations: Record<string, string>
}

export interface JournalAnswer {
  text: string
  /** User-added tags on this specific answer. */
  tags: string[]
  /** User-added key-value annotations on this answer. */
  annotations: Record<string, string>
  updated_at: string
}

/** Stored in localStorage as `journal-YYYY-MM-DD`, keyed by Prompt.id. */
export type JournalEntry = Record<string, JournalAnswer>

// ─── Prompt library ───────────────────────────────────────────────────────────

export const PROMPTS: Prompt[] = [
  // ── Morning ────────────────────────────────────────────────────────────────
  {
    id: 'morning-gratitude',
    question: 'What are you grateful for this morning?',
    when: ['morning'],
    tags: ['wellbeing/gratitude', 'mindfulness/reflection'],
    annotations: { difficulty: 'easy', time_min: '2', category: 'wellbeing' },
  },
  {
    id: 'morning-intention',
    question: "What's your main intention for today?",
    when: ['morning'],
    tags: ['productivity/planning', 'goals/daily'],
    annotations: { difficulty: 'easy', time_min: '2', category: 'productivity' },
  },
  {
    id: 'morning-energy',
    question: 'How is your energy and mood right now?',
    when: ['morning'],
    tags: ['wellbeing/mood', 'health/energy'],
    annotations: { difficulty: 'easy', time_min: '1', type: 'check-in', category: 'wellbeing' },
  },

  // ── Afternoon ──────────────────────────────────────────────────────────────
  {
    id: 'afternoon-progress',
    question: "How is today's main intention coming along?",
    when: ['afternoon'],
    tags: ['productivity/review', 'goals/daily'],
    annotations: { difficulty: 'medium', time_min: '3', category: 'productivity' },
  },
  {
    id: 'afternoon-challenge',
    question: "What's been the biggest challenge so far today?",
    when: ['afternoon'],
    tags: ['growth/challenges', 'self-awareness'],
    annotations: { difficulty: 'medium', time_min: '3', category: 'growth' },
  },

  // ── Evening ────────────────────────────────────────────────────────────────
  {
    id: 'evening-wins',
    question: 'What went well today?',
    when: ['evening'],
    tags: ['wellbeing/reflection', 'growth/wins'],
    annotations: { difficulty: 'easy', time_min: '3', category: 'reflection' },
  },
  {
    id: 'evening-learning',
    question: 'What did you learn or discover today?',
    when: ['evening'],
    tags: ['growth/learning', 'self-awareness'],
    annotations: { difficulty: 'medium', time_min: '3', category: 'growth' },
  },
  {
    id: 'evening-tomorrow',
    question: 'What one thing would make tomorrow better?',
    when: ['evening', 'night'],
    tags: ['productivity/planning', 'growth/improvement'],
    annotations: { difficulty: 'easy', time_min: '2', category: 'productivity' },
  },

  // ── Night ──────────────────────────────────────────────────────────────────
  {
    id: 'night-release',
    question: 'What are you ready to release from today?',
    when: ['night'],
    tags: ['wellbeing/release', 'mindfulness/acceptance'],
    annotations: { difficulty: 'medium', time_min: '3', category: 'wellbeing' },
  },

  // ── Anytime ────────────────────────────────────────────────────────────────
  {
    id: 'anytime-focus',
    question: "What's occupying your mind most right now?",
    when: ['anytime'],
    tags: ['self-awareness', 'mindfulness/presence'],
    annotations: { difficulty: 'easy', time_min: '2', category: 'mindfulness' },
  },
  {
    id: 'anytime-wellbeing',
    question: "On a scale from 1–10, how are you doing? What's behind that number?",
    when: ['anytime'],
    tags: ['wellbeing/mood', 'self-awareness'],
    annotations: { difficulty: 'easy', time_min: '2', type: 'check-in', category: 'wellbeing' },
  },
]
