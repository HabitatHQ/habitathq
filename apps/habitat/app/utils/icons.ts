/** Supported icon variants */
export type IconVariant = 'outline' | 'solid' | 'micro'

/** Definition of a single icon in the registry */
export interface IconDef {
  /** Outline (default) icon class */
  outline: string
  /** Solid variant icon class */
  solid?: string
  /** Micro (16px solid) variant — bolder, less detail */
  micro?: string
  /** Human-readable label (for icon picker UI) */
  label: string
  /** Category for grouping (in icon picker) */
  category: string
}

/**
 * Standard icon size classes — documented conventions, not enforced.
 * Use these as a reference when choosing icon sizes in templates.
 *
 *   xs  (12px) — badges, inline indicators
 *   sm  (14px) — toggles, small UI elements
 *   md  (16px) — buttons, navigation items
 *   lg  (20px) — main content icons, habit icons
 *   xl  (32px) — empty states, prominent displays
 */
export const ICON_SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-8 h-8',
} as const

/**
 * Icon registry — single source of truth for all icons used in the app.
 *
 * To add a new icon:       add an entry here with outline (required) and solid/micro (optional).
 * To swap icon libraries:  update the outline/solid/micro strings (e.g., 'i-heroicons-*' → 'i-lucide-*').
 * To add custom SVG icons: register with a custom prefix (e.g., 'i-custom-*') and configure the icon source.
 */
export const iconRegistry: Record<string, IconDef> = {
  // ── Common / Symbols ────────────────────────────────────────
  star: {
    outline: 'i-heroicons-star',
    solid: 'i-heroicons-star-solid',
    label: 'Star',
    category: 'common',
  },
  heart: {
    outline: 'i-heroicons-heart',
    solid: 'i-heroicons-heart-solid',
    label: 'Heart',
    category: 'common',
  },
  fire: {
    outline: 'i-heroicons-fire',
    solid: 'i-heroicons-fire-solid',
    label: 'Fire',
    category: 'common',
  },
  bolt: {
    outline: 'i-heroicons-bolt',
    solid: 'i-heroicons-bolt-solid',
    label: 'Bolt',
    category: 'common',
  },
  sparkles: {
    outline: 'i-heroicons-sparkles',
    solid: 'i-heroicons-sparkles-solid',
    label: 'Sparkles',
    category: 'common',
  },
  'light-bulb': {
    outline: 'i-heroicons-light-bulb',
    solid: 'i-heroicons-light-bulb-solid',
    label: 'Light Bulb',
    category: 'common',
  },
  beaker: {
    outline: 'i-heroicons-beaker',
    solid: 'i-heroicons-beaker-solid',
    label: 'Beaker',
    category: 'common',
  },
  'face-smile': {
    outline: 'i-heroicons-face-smile',
    solid: 'i-heroicons-face-smile-solid',
    label: 'Smiley',
    category: 'common',
  },
  scale: {
    outline: 'i-heroicons-scale',
    solid: 'i-heroicons-scale-solid',
    label: 'Scale',
    category: 'common',
  },

  // ── Navigation ──────────────────────────────────────────────
  'arrow-left': {
    outline: 'i-heroicons-arrow-left',
    solid: 'i-heroicons-arrow-left-solid',
    label: 'Arrow Left',
    category: 'navigation',
  },
  'arrow-right': {
    outline: 'i-heroicons-arrow-right',
    solid: 'i-heroicons-arrow-right-solid',
    label: 'Arrow Right',
    category: 'navigation',
  },
  'chevron-down': {
    outline: 'i-heroicons-chevron-down',
    solid: 'i-heroicons-chevron-down-solid',
    label: 'Chevron Down',
    category: 'navigation',
  },
  'chevron-left': {
    outline: 'i-heroicons-chevron-left',
    solid: 'i-heroicons-chevron-left-solid',
    label: 'Chevron Left',
    category: 'navigation',
  },
  'chevron-right': {
    outline: 'i-heroicons-chevron-right',
    solid: 'i-heroicons-chevron-right-solid',
    label: 'Chevron Right',
    category: 'navigation',
  },
  'chevron-up': {
    outline: 'i-heroicons-chevron-up',
    solid: 'i-heroicons-chevron-up-solid',
    label: 'Chevron Up',
    category: 'navigation',
  },
  home: {
    outline: 'i-heroicons-home',
    solid: 'i-heroicons-home-solid',
    label: 'Home',
    category: 'navigation',
  },
  'bars-3': {
    outline: 'i-heroicons-bars-3',
    solid: 'i-heroicons-bars-3-solid',
    label: 'Menu',
    category: 'navigation',
  },

  // ── Actions ─────────────────────────────────────────────────
  plus: {
    outline: 'i-heroicons-plus',
    solid: 'i-heroicons-plus-solid',
    label: 'Plus',
    category: 'action',
  },
  minus: {
    outline: 'i-heroicons-minus',
    solid: 'i-heroicons-minus-solid',
    label: 'Minus',
    category: 'action',
  },
  check: {
    outline: 'i-heroicons-check',
    solid: 'i-heroicons-check-solid',
    label: 'Check',
    category: 'action',
  },
  'x-mark': {
    outline: 'i-heroicons-x-mark',
    solid: 'i-heroicons-x-mark-solid',
    label: 'Close',
    category: 'action',
  },
  trash: {
    outline: 'i-heroicons-trash',
    solid: 'i-heroicons-trash-solid',
    label: 'Trash',
    category: 'action',
  },
  pencil: {
    outline: 'i-heroicons-pencil',
    solid: 'i-heroicons-pencil-solid',
    label: 'Pencil',
    category: 'action',
  },
  'pencil-square': {
    outline: 'i-heroicons-pencil-square',
    solid: 'i-heroicons-pencil-square-solid',
    label: 'Edit',
    category: 'action',
  },
  'arrow-path': {
    outline: 'i-heroicons-arrow-path',
    solid: 'i-heroicons-arrow-path-solid',
    label: 'Refresh',
    category: 'action',
  },
  'magnifying-glass': {
    outline: 'i-heroicons-magnifying-glass',
    solid: 'i-heroicons-magnifying-glass-solid',
    label: 'Search',
    category: 'action',
  },
  'arrows-right-left': {
    outline: 'i-heroicons-arrows-right-left',
    solid: 'i-heroicons-arrows-right-left-solid',
    label: 'Swap',
    category: 'action',
  },

  // ── Media ───────────────────────────────────────────────────
  play: {
    outline: 'i-heroicons-play',
    solid: 'i-heroicons-play-solid',
    micro: 'i-heroicons-play-16-solid',
    label: 'Play',
    category: 'media',
  },
  pause: {
    outline: 'i-heroicons-pause',
    solid: 'i-heroicons-pause-solid',
    micro: 'i-heroicons-pause-16-solid',
    label: 'Pause',
    category: 'media',
  },
  stop: {
    outline: 'i-heroicons-stop',
    solid: 'i-heroicons-stop-solid',
    label: 'Stop',
    category: 'media',
  },
  'stop-circle': {
    outline: 'i-heroicons-stop-circle',
    solid: 'i-heroicons-stop-circle-solid',
    label: 'Stop Circle',
    category: 'media',
  },
  microphone: {
    outline: 'i-heroicons-microphone',
    solid: 'i-heroicons-microphone-solid',
    label: 'Microphone',
    category: 'media',
  },
  photo: {
    outline: 'i-heroicons-photo',
    solid: 'i-heroicons-photo-solid',
    label: 'Photo',
    category: 'media',
  },
  camera: {
    outline: 'i-heroicons-camera',
    solid: 'i-heroicons-camera-solid',
    label: 'Camera',
    category: 'media',
  },

  // ── Status ──────────────────────────────────────────────────
  'plus-circle': {
    outline: 'i-heroicons-plus-circle',
    solid: 'i-heroicons-plus-circle-solid',
    label: 'Add',
    category: 'status',
  },
  'check-circle': {
    outline: 'i-heroicons-check-circle',
    solid: 'i-heroicons-check-circle-solid',
    label: 'Done',
    category: 'status',
  },
  'exclamation-circle': {
    outline: 'i-heroicons-exclamation-circle',
    solid: 'i-heroicons-exclamation-circle-solid',
    label: 'Warning',
    category: 'status',
  },
  'exclamation-triangle': {
    outline: 'i-heroicons-exclamation-triangle',
    solid: 'i-heroicons-exclamation-triangle-solid',
    label: 'Alert',
    category: 'status',
  },
  'shield-check': {
    outline: 'i-heroicons-shield-check',
    solid: 'i-heroicons-shield-check-solid',
    label: 'Shield',
    category: 'status',
  },
  'lock-closed': {
    outline: 'i-heroicons-lock-closed',
    solid: 'i-heroicons-lock-closed-solid',
    label: 'Locked',
    category: 'status',
  },
  'lock-open': {
    outline: 'i-heroicons-lock-open',
    solid: 'i-heroicons-lock-open-solid',
    label: 'Unlocked',
    category: 'status',
  },

  // ── Content ─────────────────────────────────────────────────
  'document-text': {
    outline: 'i-heroicons-document-text',
    solid: 'i-heroicons-document-text-solid',
    label: 'Document',
    category: 'content',
  },
  'book-open': {
    outline: 'i-heroicons-book-open',
    solid: 'i-heroicons-book-open-solid',
    label: 'Book',
    category: 'content',
  },
  'clipboard-document-list': {
    outline: 'i-heroicons-clipboard-document-list',
    solid: 'i-heroicons-clipboard-document-list-solid',
    label: 'Clipboard',
    category: 'content',
  },
  tag: {
    outline: 'i-heroicons-tag',
    solid: 'i-heroicons-tag-solid',
    label: 'Tag',
    category: 'content',
  },
  link: {
    outline: 'i-heroicons-link',
    solid: 'i-heroicons-link-solid',
    label: 'Link',
    category: 'content',
  },
  'paper-clip': {
    outline: 'i-heroicons-paper-clip',
    solid: 'i-heroicons-paper-clip-solid',
    label: 'Attachment',
    category: 'content',
  },

  // ── Time ────────────────────────────────────────────────────
  calendar: {
    outline: 'i-heroicons-calendar',
    solid: 'i-heroicons-calendar-solid',
    label: 'Calendar',
    category: 'time',
  },
  'calendar-days': {
    outline: 'i-heroicons-calendar-days',
    solid: 'i-heroicons-calendar-days-solid',
    label: 'Date',
    category: 'time',
  },
  clock: {
    outline: 'i-heroicons-clock',
    solid: 'i-heroicons-clock-solid',
    label: 'Clock',
    category: 'time',
  },
  bell: {
    outline: 'i-heroicons-bell',
    solid: 'i-heroicons-bell-solid',
    label: 'Bell',
    category: 'time',
  },

  // ── Data ────────────────────────────────────────────────────
  'chart-bar': {
    outline: 'i-heroicons-chart-bar',
    solid: 'i-heroicons-chart-bar-solid',
    label: 'Chart',
    category: 'data',
  },
  'table-cells': {
    outline: 'i-heroicons-table-cells',
    solid: 'i-heroicons-table-cells-solid',
    label: 'Table',
    category: 'data',
  },
  'squares-2x2': {
    outline: 'i-heroicons-squares-2x2',
    solid: 'i-heroicons-squares-2x2-solid',
    label: 'Grid',
    category: 'data',
  },
  'list-bullet': {
    outline: 'i-heroicons-list-bullet',
    solid: 'i-heroicons-list-bullet-solid',
    label: 'List',
    category: 'data',
  },

  // ── Nature ──────────────────────────────────────────────────
  sun: {
    outline: 'i-heroicons-sun',
    solid: 'i-heroicons-sun-solid',
    label: 'Sun',
    category: 'nature',
  },
  moon: {
    outline: 'i-heroicons-moon',
    solid: 'i-heroicons-moon-solid',
    label: 'Moon',
    category: 'nature',
  },

  // ── System ──────────────────────────────────────────────────
  'cog-6-tooth': {
    outline: 'i-heroicons-cog-6-tooth',
    solid: 'i-heroicons-cog-6-tooth-solid',
    label: 'Settings',
    category: 'system',
  },
  'circle-stack': {
    outline: 'i-heroicons-circle-stack',
    solid: 'i-heroicons-circle-stack-solid',
    label: 'Database',
    category: 'system',
  },
  inbox: {
    outline: 'i-heroicons-inbox',
    solid: 'i-heroicons-inbox-solid',
    label: 'Inbox',
    category: 'system',
  },
  'archive-box': {
    outline: 'i-heroicons-archive-box',
    solid: 'i-heroicons-archive-box-solid',
    label: 'Archive',
    category: 'system',
  },
  swatch: {
    outline: 'i-heroicons-swatch',
    solid: 'i-heroicons-swatch-solid',
    label: 'Theme',
    category: 'system',
  },
  'adjustments-horizontal': {
    outline: 'i-heroicons-adjustments-horizontal',
    solid: 'i-heroicons-adjustments-horizontal-solid',
    label: 'Adjust',
    category: 'system',
  },
  'ellipsis-horizontal-circle': {
    outline: 'i-heroicons-ellipsis-horizontal-circle',
    solid: 'i-heroicons-ellipsis-horizontal-circle-solid',
    label: 'More',
    category: 'system',
  },
  'battery-100': { outline: 'i-heroicons-battery-100', label: 'Battery', category: 'system' },
  'user-circle': {
    outline: 'i-heroicons-user-circle',
    solid: 'i-heroicons-user-circle-solid',
    label: 'User',
    category: 'system',
  },

  // ── Transfer ────────────────────────────────────────────────
  'arrow-down-tray': {
    outline: 'i-heroicons-arrow-down-tray',
    solid: 'i-heroicons-arrow-down-tray-solid',
    label: 'Download',
    category: 'transfer',
  },
  'arrow-up-tray': {
    outline: 'i-heroicons-arrow-up-tray',
    solid: 'i-heroicons-arrow-up-tray-solid',
    label: 'Upload',
    category: 'transfer',
  },
  'arrow-up-on-square': {
    outline: 'i-heroicons-arrow-up-on-square',
    solid: 'i-heroicons-arrow-up-on-square-solid',
    label: 'Share',
    category: 'transfer',
  },
  'arrow-top-right-on-square': {
    outline: 'i-heroicons-arrow-top-right-on-square',
    solid: 'i-heroicons-arrow-top-right-on-square-solid',
    label: 'External',
    category: 'transfer',
  },
}

/**
 * Resolve an icon name to its underlying class string.
 *
 * Accepts either:
 *  - A registry key (e.g., 'star') → looks up in iconRegistry
 *  - A raw icon class (e.g., 'i-heroicons-star') → returned as-is
 *
 * Falls back to outline when the requested variant is unavailable.
 */
export function resolveIcon(name: string, variant: IconVariant = 'outline'): string {
  // Pass through raw icon classes (from DB or other icon libraries)
  if (name.startsWith('i-')) return name

  const entry = iconRegistry[name]
  if (!entry) return name

  if (variant === 'solid' && entry.solid) return entry.solid
  if (variant === 'micro' && entry.micro) return entry.micro
  return entry.outline
}

/**
 * Get all icons grouped by category — useful for icon picker UIs.
 * Each entry includes the registry key as `name`.
 */
export function iconsByCategory(): Record<string, Array<{ name: string } & IconDef>> {
  const grouped: Record<string, Array<{ name: string } & IconDef>> = {}
  for (const [name, def] of Object.entries(iconRegistry)) {
    const cat = def.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({ name, ...def })
  }
  return grouped
}
