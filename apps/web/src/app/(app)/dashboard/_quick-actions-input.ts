import { z } from 'zod'
import { MAX_QUICK_ACTIONS } from './_quick-actions-shared'

// An href is safe to persist when it's an internal path or an http(s) URL —
// never a `javascript:`/`data:` scheme.
const safeHref = (href: string) => href.startsWith('/') || /^https?:\/\//i.test(href)

const QuickActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  href: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(safeHref, 'Link must be an internal path or http(s) URL'),
  iconKey: z.string().min(1).max(48),
  tone: z.string().min(1).max(24),
})

export const QuickActionsSchema = z.array(QuickActionSchema).max(MAX_QUICK_ACTIONS)
