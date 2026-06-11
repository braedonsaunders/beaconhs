// Shared constants + types for the document editor.

export const PAGE_SIZES = {
  Letter: { label: 'Letter', wPx: 816, hPx: 1056 }, // 8.5 × 11 in @ 96dpi
  A4: { label: 'A4', wPx: 794, hPx: 1123 }, // 210 × 297 mm @ 96dpi
} as const
export type PageSizeKey = keyof typeof PAGE_SIZES

export const PAGE_MARGIN_PX = 96 // 1in default margin @ 96dpi (matches the PDF's 1in margin)
export const PAGE_GAP_PX = 28 // gray gap shown between pages in the editor
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, sans-serif' },
  { label: 'Courier', value: 'ui-monospace, "Courier New", monospace' },
]

export const FONT_SIZES = [
  '10px',
  '11px',
  '12px',
  '14px',
  '16px',
  '18px',
  '24px',
  '30px',
  '36px',
  '48px',
]

export const LINE_SPACINGS: { label: string; value: string }[] = [
  { label: 'Single', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: 'Double', value: '2' },
]

export const TEXT_COLORS = [
  '#0f172a',
  '#475569',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#0ea5e9',
  '#0f766e',
  '#6366f1',
  '#ec4899',
]
export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff']

// Client-side comment row (mirrors DocumentCommentRow from _actions.ts).
export type EditorComment = {
  id: string
  anchorId: string | null
  quotedText: string | null
  body: string
  threadId: string | null
  resolvedAt: string | null
  createdAt: string
  authorName: string
  authorTenantUserId: string
}

export type EditorUser = { tenantUserId: string | null; name: string }
