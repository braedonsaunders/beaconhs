// Shared tag colour palette. Pure module (no 'use server'/'use client') so the
// client picker + chips and the server-rendered admin page render identically.
// Class strings are full literals so Tailwind's content scanner emits them.

export type TagColorKey =
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'violet'
  | 'pink'

export const TAG_COLOR_KEYS: TagColorKey[] = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
]

/** Default when a tag has no colour set — matches the app's historic teal chip. */
export const DEFAULT_TAG_COLOR: TagColorKey = 'teal'

type Swatch = {
  /** Chip surface: background + text + ring colours. */
  chip: string
  /** Solid dot / swatch background. */
  dot: string
  /** Hover background for the chip's remove button. */
  remove: string
  label: string
}

const PALETTE: Record<TagColorKey, Swatch> = {
  slate: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-200 dark:ring-slate-400/25',
    dot: 'bg-slate-400',
    remove: 'hover:bg-slate-300/60 dark:hover:bg-slate-400/30',
    label: 'Slate',
  },
  red: {
    chip: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/25',
    dot: 'bg-red-500',
    remove: 'hover:bg-red-200/70 dark:hover:bg-red-400/30',
    label: 'Red',
  },
  orange: {
    chip: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-500/25',
    dot: 'bg-orange-500',
    remove: 'hover:bg-orange-200/70 dark:hover:bg-orange-400/30',
    label: 'Orange',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/25',
    dot: 'bg-amber-500',
    remove: 'hover:bg-amber-200/70 dark:hover:bg-amber-400/30',
    label: 'Amber',
  },
  green: {
    chip: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/15 dark:text-green-200 dark:ring-green-500/25',
    dot: 'bg-green-500',
    remove: 'hover:bg-green-200/70 dark:hover:bg-green-400/30',
    label: 'Green',
  },
  teal: {
    chip: 'bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-500/15 dark:text-teal-200 dark:ring-teal-500/25',
    dot: 'bg-teal-500',
    remove: 'hover:bg-teal-200/70 dark:hover:bg-teal-400/30',
    label: 'Teal',
  },
  blue: {
    chip: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/25',
    dot: 'bg-blue-500',
    remove: 'hover:bg-blue-200/70 dark:hover:bg-blue-400/30',
    label: 'Blue',
  },
  violet: {
    chip: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/25',
    dot: 'bg-violet-500',
    remove: 'hover:bg-violet-200/70 dark:hover:bg-violet-400/30',
    label: 'Violet',
  },
  pink: {
    chip: 'bg-pink-50 text-pink-700 ring-pink-600/20 dark:bg-pink-500/15 dark:text-pink-200 dark:ring-pink-500/25',
    dot: 'bg-pink-500',
    remove: 'hover:bg-pink-200/70 dark:hover:bg-pink-400/30',
    label: 'Pink',
  },
}

export function tagSwatch(color?: string | null): Swatch {
  return PALETTE[color as TagColorKey] ?? PALETTE[DEFAULT_TAG_COLOR]
}

export function isTagColor(value: unknown): value is TagColorKey {
  return typeof value === 'string' && (TAG_COLOR_KEYS as string[]).includes(value)
}
