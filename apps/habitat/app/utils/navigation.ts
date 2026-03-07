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
  { to: '/', icon: 'i-heroicons-home', label: 'Today', today: true },
  { to: '/habits', icon: 'i-heroicons-list-bullet', label: 'Habits' },
  { to: '/checkin', icon: 'i-heroicons-pencil-square', label: 'Check-in', journalling: true },
  { to: '/todos', icon: 'i-heroicons-check-circle', label: 'TODOs', todos: true },
  { to: '/bored', icon: 'i-heroicons-face-smile', label: 'Bored', bored: true },
  { to: '/health', icon: 'i-heroicons-heart', label: 'Health', health: true },
  { to: '/jots', icon: 'i-heroicons-document-text', label: 'Jots', journalling: true },
]
