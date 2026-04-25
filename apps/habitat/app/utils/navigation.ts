import { resolveIcon } from '~/utils/icons'

export interface NavItem {
  to: string
  icon: string
  label: string
  today?: boolean
  health?: boolean
  todos?: boolean
  bored?: boolean
  journalling?: boolean
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { to: '/', icon: resolveIcon('home'), label: 'Today', today: true },
  { to: '/habits', icon: resolveIcon('list-bullet'), label: 'Habits' },
  { to: '/checkin', icon: resolveIcon('pencil-square'), label: 'Check-in', journalling: true },
  { to: '/todos', icon: resolveIcon('check-circle'), label: 'TODOs', todos: true },
  { to: '/bored', icon: resolveIcon('face-smile'), label: 'Bored', bored: true },
  { to: '/health', icon: resolveIcon('heart'), label: 'Health', health: true },
  { to: '/jots', icon: resolveIcon('document-text'), label: 'Jots', journalling: true },
]
