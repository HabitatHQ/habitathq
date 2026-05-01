import type { ProgramDayRow } from '~/types/database'

export interface BuiltinProgram {
  name: string
  description: string
  weeks: number
  structure: Array<{
    weekNum: number
    isDeload: boolean
    intensityModifier: number
    volumeModifier: number
    phase?: string
  }>
}

export const BUILTIN_PROGRAMS: BuiltinProgram[] = [
  {
    name: '5/3/1 BBB',
    description: "Jim Wendler's 5/3/1 with Boring But Big assistance work.",
    weeks: 4,
    structure: [
      { weekNum: 1, isDeload: false, intensityModifier: 0.65, volumeModifier: 1.0 },
      { weekNum: 2, isDeload: false, intensityModifier: 0.7, volumeModifier: 1.0 },
      { weekNum: 3, isDeload: false, intensityModifier: 0.75, volumeModifier: 1.0 },
      { weekNum: 4, isDeload: true, intensityModifier: 0.4, volumeModifier: 0.6, phase: 'deload' },
    ],
  },
  {
    name: 'GZCLP',
    description: "Greyskull's linear progression for beginners.",
    weeks: 12,
    structure: Array.from({ length: 12 }, (_, i) => ({
      weekNum: i + 1,
      isDeload: (i + 1) % 4 === 0,
      intensityModifier: 1.0 + i * 0.025,
      volumeModifier: 1.0,
    })),
  },
  {
    name: 'PPL (Push Pull Legs)',
    description: '6-day Push/Pull/Legs split for intermediate lifters.',
    weeks: 8,
    structure: Array.from({ length: 8 }, (_, i) => ({
      weekNum: i + 1,
      isDeload: i === 7,
      intensityModifier: 1.0,
      volumeModifier: i === 7 ? 0.6 : 1.0,
    })),
  },
  {
    name: 'PHUL (Power Hypertrophy Upper Lower)',
    description: '4-day Upper/Lower split combining strength and hypertrophy.',
    weeks: 8,
    structure: Array.from({ length: 8 }, (_, i) => ({
      weekNum: i + 1,
      isDeload: i === 7,
      intensityModifier: 1.0,
      volumeModifier: 1.0,
    })),
  },
  {
    name: 'Upper/Lower A/B',
    description: '4-day Upper/Lower alternating A and B days.',
    weeks: 8,
    structure: Array.from({ length: 8 }, (_, i) => ({
      weekNum: i + 1,
      isDeload: i === 7,
      intensityModifier: 1.0,
      volumeModifier: 1.0,
    })),
  },
]

/**
 * Calculate the current program week (1-indexed) based on startedAt and refDate.
 */
export function calculateProgramWeek(startedAt: Date, refDate: Date): number {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksPassed = Math.floor((refDate.getTime() - startedAt.getTime()) / msPerWeek)
  return weeksPassed + 1
}

/**
 * Get program days scheduled for today based on day_num matching today's weekday (0=Sun).
 */
export function getTodaysProgramDays(days: ProgramDayRow[], today: Date): ProgramDayRow[] {
  const todayNum = today.getDay()
  return days.filter((d) => d.day_num === todayNum)
}
