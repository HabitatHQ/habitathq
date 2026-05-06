/** Definition of a single icon in the registry */
export interface IconDef {
  /** Icon class (Lucide via Iconify) */
  outline: string
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
 * All icons use Lucide via Iconify (`i-lucide-*`).
 *
 * To add a new icon:       add an entry here with outline (required).
 * To add custom SVG icons: register with a custom prefix (e.g., 'i-custom-*') and configure the icon source.
 */
export const iconRegistry: Record<string, IconDef> = {
  // ── Common / Symbols ────────────────────────────────────────
  star: { outline: 'i-lucide-star', label: 'Star', category: 'common' },
  heart: { outline: 'i-lucide-heart', label: 'Heart', category: 'common' },
  fire: { outline: 'i-lucide-flame', label: 'Fire', category: 'common' },
  bolt: { outline: 'i-lucide-zap', label: 'Bolt', category: 'common' },
  sparkles: { outline: 'i-lucide-sparkles', label: 'Sparkles', category: 'common' },
  'light-bulb': { outline: 'i-lucide-lightbulb', label: 'Light Bulb', category: 'common' },
  beaker: { outline: 'i-lucide-flask-conical', label: 'Beaker', category: 'common' },
  'face-smile': { outline: 'i-lucide-laugh', label: 'Smiley', category: 'common' },
  scale: { outline: 'i-lucide-scale', label: 'Scale', category: 'common' },
  'thumbs-up': { outline: 'i-lucide-thumbs-up', label: 'Approval', category: 'common' },
  'infinity-icon': { outline: 'i-lucide-infinity', label: 'Continuous', category: 'common' },

  // ── Navigation ──────────────────────────────────────────────
  'arrow-left': { outline: 'i-lucide-arrow-left', label: 'Arrow Left', category: 'navigation' },
  'arrow-right': { outline: 'i-lucide-arrow-right', label: 'Arrow Right', category: 'navigation' },
  'arrow-up': { outline: 'i-lucide-arrow-up', label: 'Arrow Up', category: 'navigation' },
  'arrow-down': { outline: 'i-lucide-arrow-down', label: 'Arrow Down', category: 'navigation' },
  'arrow-uturn-left': { outline: 'i-lucide-undo-2', label: 'Undo', category: 'navigation' },
  'chevron-down': {
    outline: 'i-lucide-chevron-down',
    label: 'Chevron Down',
    category: 'navigation',
  },
  'chevron-left': {
    outline: 'i-lucide-chevron-left',
    label: 'Chevron Left',
    category: 'navigation',
  },
  'chevron-right': {
    outline: 'i-lucide-chevron-right',
    label: 'Chevron Right',
    category: 'navigation',
  },
  'chevron-up': { outline: 'i-lucide-chevron-up', label: 'Chevron Up', category: 'navigation' },
  home: { outline: 'i-lucide-house', label: 'Home', category: 'navigation' },
  'bars-3': { outline: 'i-lucide-menu', label: 'Menu', category: 'navigation' },

  // ── Actions ─────────────────────────────────────────────────
  plus: { outline: 'i-lucide-plus', label: 'Plus', category: 'action' },
  minus: { outline: 'i-lucide-minus', label: 'Minus', category: 'action' },
  check: { outline: 'i-lucide-check', label: 'Check', category: 'action' },
  'x-mark': { outline: 'i-lucide-x', label: 'Close', category: 'action' },
  trash: { outline: 'i-lucide-trash-2', label: 'Trash', category: 'action' },
  backspace: { outline: 'i-lucide-delete', label: 'Backspace', category: 'action' },
  pencil: { outline: 'i-lucide-pencil', label: 'Pencil', category: 'action' },
  'paper-airplane': { outline: 'i-lucide-send', label: 'Send', category: 'action' },
  'pencil-square': { outline: 'i-lucide-square-pen', label: 'Edit', category: 'action' },
  'arrow-path': { outline: 'i-lucide-refresh-cw', label: 'Refresh', category: 'action' },
  'magnifying-glass': { outline: 'i-lucide-search', label: 'Search', category: 'action' },
  'arrows-right-left': { outline: 'i-lucide-arrow-left-right', label: 'Swap', category: 'action' },

  // ── Media ───────────────────────────────────────────────────
  play: { outline: 'i-lucide-play', label: 'Play', category: 'media' },
  pause: { outline: 'i-lucide-pause', label: 'Pause', category: 'media' },
  stop: { outline: 'i-lucide-square', label: 'Stop', category: 'media' },
  'stop-circle': { outline: 'i-lucide-circle-stop', label: 'Stop Circle', category: 'media' },
  microphone: { outline: 'i-lucide-mic', label: 'Microphone', category: 'media' },
  photo: { outline: 'i-lucide-image', label: 'Photo', category: 'media' },
  camera: { outline: 'i-lucide-camera', label: 'Camera', category: 'media' },

  // ── Status ──────────────────────────────────────────────────
  'plus-circle': { outline: 'i-lucide-circle-plus', label: 'Add', category: 'status' },
  'check-circle': { outline: 'i-lucide-circle-check', label: 'Done', category: 'status' },
  'exclamation-circle': { outline: 'i-lucide-circle-alert', label: 'Warning', category: 'status' },
  'exclamation-triangle': {
    outline: 'i-lucide-triangle-alert',
    label: 'Alert',
    category: 'status',
  },
  'shield-check': { outline: 'i-lucide-shield-check', label: 'Shield', category: 'status' },
  'eye-slash': { outline: 'i-lucide-eye-off', label: 'Hidden', category: 'status' },
  'question-mark-circle': { outline: 'i-lucide-circle-help', label: 'Help', category: 'status' },
  'lock-closed': { outline: 'i-lucide-lock', label: 'Locked', category: 'status' },
  'lock-open': { outline: 'i-lucide-lock-open', label: 'Unlocked', category: 'status' },

  // ── Content ─────────────────────────────────────────────────
  'document-text': { outline: 'i-lucide-file-text', label: 'Document', category: 'content' },
  'book-open': { outline: 'i-lucide-book-open', label: 'Book', category: 'content' },
  'clipboard-document-list': {
    outline: 'i-lucide-clipboard-list',
    label: 'Clipboard',
    category: 'content',
  },
  tag: { outline: 'i-lucide-tag', label: 'Tag', category: 'content' },
  link: { outline: 'i-lucide-link', label: 'Link', category: 'content' },
  'paper-clip': { outline: 'i-lucide-paperclip', label: 'Attachment', category: 'content' },

  // ── Time ────────────────────────────────────────────────────
  calendar: { outline: 'i-lucide-calendar', label: 'Calendar', category: 'time' },
  'calendar-days': { outline: 'i-lucide-calendar-days', label: 'Date', category: 'time' },
  clock: { outline: 'i-lucide-clock', label: 'Clock', category: 'time' },
  bell: { outline: 'i-lucide-bell', label: 'Bell', category: 'time' },

  // ── Data ────────────────────────────────────────────────────
  'chart-bar': { outline: 'i-lucide-chart-bar', label: 'Chart', category: 'data' },
  'table-cells': { outline: 'i-lucide-table', label: 'Table', category: 'data' },
  'squares-2x2': { outline: 'i-lucide-grid-2x2', label: 'Grid', category: 'data' },
  'list-bullet': { outline: 'i-lucide-list', label: 'List', category: 'data' },

  // ── Nature ──────────────────────────────────────────────────
  sun: { outline: 'i-lucide-sun', label: 'Sun', category: 'outdoors' },
  moon: { outline: 'i-lucide-moon', label: 'Moon', category: 'outdoors' },

  // ── System ──────────────────────────────────────────────────
  'cog-6-tooth': { outline: 'i-lucide-settings', label: 'Settings', category: 'system' },
  'circle-stack': { outline: 'i-lucide-database', label: 'Database', category: 'system' },
  inbox: { outline: 'i-lucide-inbox', label: 'Inbox', category: 'system' },
  'archive-box': { outline: 'i-lucide-archive', label: 'Archive', category: 'system' },
  swatch: { outline: 'i-lucide-palette', label: 'Theme', category: 'system' },
  'adjustments-horizontal': {
    outline: 'i-lucide-sliders-horizontal',
    label: 'Adjust',
    category: 'system',
  },
  'ellipsis-horizontal-circle': { outline: 'i-lucide-ellipsis', label: 'More', category: 'system' },
  'battery-100': { outline: 'i-lucide-battery-full', label: 'Battery', category: 'system' },
  'user-circle': { outline: 'i-lucide-circle-user', label: 'User', category: 'system' },
  user: { outline: 'i-lucide-user', label: 'User', category: 'system' },
  'device-phone-mobile': {
    outline: 'i-lucide-smartphone',
    label: 'Mobile Device',
    category: 'system',
  },

  // ── Transfer ────────────────────────────────────────────────
  'arrow-down-tray': { outline: 'i-lucide-download', label: 'Download', category: 'transfer' },
  'arrow-up-tray': { outline: 'i-lucide-upload', label: 'Upload', category: 'transfer' },
  'document-arrow-up': { outline: 'i-lucide-file-up', label: 'Upload File', category: 'transfer' },
  'arrow-up-on-square': { outline: 'i-lucide-share', label: 'Share', category: 'transfer' },
  'arrow-top-right-on-square': {
    outline: 'i-lucide-external-link',
    label: 'External',
    category: 'transfer',
  },

  // ── Fitness & Health ────────────────────────────────────────
  barbell: { outline: 'i-lucide-dumbbell', label: 'Barbell', category: 'fitness' },
  running: { outline: 'i-lucide-person-standing', label: 'Running', category: 'fitness' },
  cycling: { outline: 'i-lucide-bike', label: 'Cycling', category: 'fitness' },
  heartbeat: { outline: 'i-lucide-heart-pulse', label: 'Heartbeat', category: 'fitness' },
  sneaker: { outline: 'i-lucide-footprints', label: 'Walking', category: 'fitness' },
  yoga: { outline: 'i-lucide-accessibility', label: 'Yoga', category: 'fitness' },
  stretching: { outline: 'i-lucide-move', label: 'Stretching', category: 'fitness' },
  trophy: { outline: 'i-lucide-trophy', label: 'Trophy', category: 'fitness' },
  medal: { outline: 'i-lucide-medal', label: 'Medal', category: 'fitness' },
  basketball: { outline: 'i-lucide-circle-dot', label: 'Basketball', category: 'fitness' },
  activity: { outline: 'i-lucide-activity', label: 'Cardio', category: 'fitness' },
  waves: { outline: 'i-lucide-waves', label: 'Swimming', category: 'fitness' },
  weight: { outline: 'i-lucide-weight', label: 'Lifting', category: 'fitness' },

  // ── Food & Drink ────────────────────────────────────────────
  'cooking-pot': { outline: 'i-lucide-cooking-pot', label: 'Cooking', category: 'food' },
  coffee: { outline: 'i-lucide-coffee', label: 'Coffee', category: 'food' },
  wine: { outline: 'i-lucide-wine', label: 'Wine', category: 'food' },
  apple: { outline: 'i-lucide-apple', label: 'Apple', category: 'food' },
  'water-drop': { outline: 'i-lucide-droplets', label: 'Water', category: 'food' },
  'bowl-food': { outline: 'i-lucide-soup', label: 'Bowl', category: 'food' },
  beer: { outline: 'i-lucide-beer', label: 'Beer', category: 'food' },
  leaf: { outline: 'i-lucide-leaf', label: 'Leaf', category: 'food' },
  utensils: { outline: 'i-lucide-utensils', label: 'Meals', category: 'food' },
  salad: { outline: 'i-lucide-salad', label: 'Healthy Eating', category: 'food' },
  egg: { outline: 'i-lucide-egg-fried', label: 'Breakfast', category: 'food' },

  // ── Mind & Learning ─────────────────────────────────────────
  reading: { outline: 'i-lucide-book-open-text', label: 'Reading', category: 'learning' },
  brain: { outline: 'i-lucide-brain', label: 'Brain', category: 'learning' },
  graduation: { outline: 'i-lucide-graduation-cap', label: 'Study', category: 'learning' },
  puzzle: { outline: 'i-lucide-puzzle', label: 'Puzzle', category: 'learning' },
  lightbulb: { outline: 'i-lucide-lamp', label: 'Ideas', category: 'learning' },
  writing: { outline: 'i-lucide-pen-tool', label: 'Writing', category: 'learning' },
  translate: { outline: 'i-lucide-languages', label: 'Language', category: 'learning' },
  headphones: { outline: 'i-lucide-headphones', label: 'Listening', category: 'learning' },
  notebook: { outline: 'i-lucide-notebook-pen', label: 'Journaling', category: 'learning' },
  library: { outline: 'i-lucide-library', label: 'Library', category: 'learning' },
  podcast: { outline: 'i-lucide-podcast', label: 'Podcasts', category: 'learning' },

  // ── Wellness & Self-care ────────────────────────────────────
  bed: { outline: 'i-lucide-bed', label: 'Sleep', category: 'wellness' },
  bathtub: { outline: 'i-lucide-bath', label: 'Self-care', category: 'wellness' },
  'flower-lotus': { outline: 'i-lucide-flower-2', label: 'Meditation', category: 'wellness' },
  smiley: { outline: 'i-lucide-smile', label: 'Mood', category: 'wellness' },
  sunrise: { outline: 'i-lucide-sunrise', label: 'Morning', category: 'wellness' },
  'moon-stars': { outline: 'i-lucide-moon-star', label: 'Evening', category: 'wellness' },
  tooth: { outline: 'i-lucide-cross', label: 'Dental', category: 'wellness' },
  'eye-care': { outline: 'i-lucide-eye', label: 'Eye Care', category: 'wellness' },
  pill: { outline: 'i-lucide-pill', label: 'Medication', category: 'wellness' },
  shower: { outline: 'i-lucide-shower-head', label: 'Hygiene', category: 'wellness' },
  'sofa-relax': { outline: 'i-lucide-sofa', label: 'Relaxation', category: 'wellness' },

  // ── Productivity & Work ─────────────────────────────────────
  briefcase: { outline: 'i-lucide-briefcase', label: 'Work', category: 'productivity' },
  code: { outline: 'i-lucide-code', label: 'Code', category: 'productivity' },
  rocket: { outline: 'i-lucide-rocket', label: 'Launch', category: 'productivity' },
  target: { outline: 'i-lucide-target', label: 'Goal', category: 'productivity' },
  timer: { outline: 'i-lucide-timer', label: 'Timer', category: 'productivity' },
  'calendar-check': { outline: 'i-lucide-calendar-check', label: 'Plan', category: 'productivity' },
  clipboard: { outline: 'i-lucide-clipboard', label: 'Tasks', category: 'productivity' },
  'chart-up': { outline: 'i-lucide-trending-up', label: 'Progress', category: 'productivity' },
  'list-checks': { outline: 'i-lucide-list-checks', label: 'Checklists', category: 'productivity' },
  hourglass: { outline: 'i-lucide-hourglass', label: 'Time Mgmt', category: 'productivity' },
  alarm: { outline: 'i-lucide-alarm-clock', label: 'Wake Up', category: 'productivity' },

  // ── Creative & Hobbies ──────────────────────────────────────
  guitar: { outline: 'i-lucide-guitar', label: 'Guitar', category: 'creative' },
  'music-notes': { outline: 'i-lucide-music', label: 'Music', category: 'creative' },
  'paint-brush': { outline: 'i-lucide-paintbrush', label: 'Art', category: 'creative' },
  'camera-ph': { outline: 'i-lucide-aperture', label: 'Photography', category: 'creative' },
  'game-controller': { outline: 'i-lucide-gamepad-2', label: 'Gaming', category: 'creative' },
  'potted-plant': { outline: 'i-lucide-sprout', label: 'Gardening', category: 'creative' },
  scissors: { outline: 'i-lucide-scissors', label: 'Crafts', category: 'creative' },
  palette: { outline: 'i-lucide-shapes', label: 'Design', category: 'creative' },
  film: { outline: 'i-lucide-film', label: 'Film', category: 'creative' },
  drama: { outline: 'i-lucide-drama', label: 'Theater', category: 'creative' },
  'mic-vocal': { outline: 'i-lucide-mic-vocal', label: 'Singing', category: 'creative' },

  // ── Social & Communication ──────────────────────────────────
  users: { outline: 'i-lucide-users', label: 'Friends', category: 'social' },
  'user-group': { outline: 'i-lucide-users-round', label: 'Group', category: 'social' },
  'phone-call': { outline: 'i-lucide-phone', label: 'Calls', category: 'social' },
  'chat-circle': { outline: 'i-lucide-message-circle', label: 'Chat', category: 'social' },
  envelope: { outline: 'i-lucide-mail', label: 'Email', category: 'social' },
  'hand-heart': { outline: 'i-lucide-heart-handshake', label: 'Volunteering', category: 'social' },
  handshake: { outline: 'i-lucide-handshake', label: 'Networking', category: 'social' },
  baby: { outline: 'i-lucide-baby', label: 'Parenting', category: 'social' },
  gift: { outline: 'i-lucide-gift', label: 'Gifting', category: 'social' },
  party: { outline: 'i-lucide-party-popper', label: 'Celebrations', category: 'social' },

  // ── Finance ─────────────────────────────────────────────────
  'piggy-bank': { outline: 'i-lucide-piggy-bank', label: 'Savings', category: 'finance' },
  wallet: { outline: 'i-lucide-wallet', label: 'Budget', category: 'finance' },
  coin: { outline: 'i-lucide-coins', label: 'Investment', category: 'finance' },
  receipt: { outline: 'i-lucide-receipt', label: 'Expenses', category: 'finance' },
  banknote: { outline: 'i-lucide-banknote', label: 'Cash', category: 'finance' },
  'hand-coins': { outline: 'i-lucide-hand-coins', label: 'Donations', category: 'finance' },
  'credit-card': { outline: 'i-lucide-credit-card', label: 'Credit Card', category: 'finance' },
  'currency-dollar': {
    outline: 'i-lucide-circle-dollar-sign',
    label: 'Currency',
    category: 'finance',
  },
  'building-library': { outline: 'i-lucide-landmark', label: 'Bank', category: 'finance' },
  'building-storefront': { outline: 'i-lucide-store', label: 'Store', category: 'finance' },

  // ── Nature & Outdoors ───────────────────────────────────────
  tree: { outline: 'i-lucide-tree-pine', label: 'Nature', category: 'outdoors' },
  mountains: { outline: 'i-lucide-mountain', label: 'Hiking', category: 'outdoors' },
  tent: { outline: 'i-lucide-tent', label: 'Camping', category: 'outdoors' },
  dog: { outline: 'i-lucide-dog', label: 'Pet Care', category: 'outdoors' },
  'paw-print': { outline: 'i-lucide-paw-print', label: 'Animals', category: 'outdoors' },
  compass: { outline: 'i-lucide-compass', label: 'Exploration', category: 'outdoors' },
  fish: { outline: 'i-lucide-fish', label: 'Fishing', category: 'outdoors' },
  umbrella: { outline: 'i-lucide-umbrella', label: 'Weather', category: 'outdoors' },

  // ── Travel ────────────────────────────────────────────────────
  plane: { outline: 'i-lucide-plane', label: 'Flying', category: 'travel' },
  backpack: { outline: 'i-lucide-backpack', label: 'Travel', category: 'travel' },
  'map-pin': { outline: 'i-lucide-map-pin', label: 'Places', category: 'travel' },

  // ── Health & Medical ──────────────────────────────────────────
  stethoscope: { outline: 'i-lucide-stethoscope', label: 'Doctor', category: 'health' },
  thermometer: { outline: 'i-lucide-thermometer', label: 'Temperature', category: 'health' },
  syringe: { outline: 'i-lucide-syringe', label: 'Injections', category: 'health' },
}

/**
 * Resolve an icon name to its underlying class string.
 *
 * Accepts either:
 *  - A registry key (e.g., 'star') → looks up in iconRegistry
 *  - A raw icon class (e.g., 'i-lucide-star') → returned as-is
 */
export function resolveIcon(name: string): string {
  if (name.startsWith('i-')) return name

  const entry = iconRegistry[name]
  if (!entry) return name

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

/**
 * Get the underlying lucide icon names (e.g. ['lucide:star', ...]) for
 * use with `@nuxt/icon`'s `clientBundle.icons` at build time.
 */
export function getRegistryIconifyNames(): string[] {
  return Object.values(iconRegistry).map((def) => {
    // 'i-lucide-arrow-left' → 'lucide:arrow-left'
    const stripped = def.outline.replace(/^i-/, '')
    const dash = stripped.indexOf('-')
    return dash === -1 ? stripped : `${stripped.slice(0, dash)}:${stripped.slice(dash + 1)}`
  })
}
