'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight, Settings2, Zap } from 'lucide-react'
import {
  DEFAULT_QUICK_ACTIONS,
  isExternalHref,
  toneOf,
  type QuickAction,
  type SaveQuickActionsAction,
} from './_quick-actions-shared'
import { FALLBACK_ICON, QUICK_ACTION_ICONS } from './_quick-actions-icons'
import { QuickActionsEditor } from './_quick-actions-editor'

/**
 * The dashboard "Quick actions" card. A user-customisable grid of shortcut
 * tiles — each resolves to an internal route, a Builder app/form, or a custom
 * URL, with its own icon and colour (edited via the drawer in this file).
 *
 * Layout is fully container-driven so the card resizes in BOTH axes and never
 * needs an inner scrollbar:
 *   • columns — `auto-fit` reflows to the card's width (many-across when wide,
 *     down to 1 when narrow), so it works at any column span and on mobile.
 *   • rows    — `auto-rows-fr` stretches the tiles to fill the card's height,
 *     so making the card taller pushes the cards below it down and the tiles
 *     simply grow. In the natural-height mobile stack the rows size to content.
 *
 * Self-contained card (not wrapped in CardShell) so it owns its header — and
 * the "Customize" affordance that opens the editor.
 */
export function QuickActions({
  actions,
  saveAction,
  saveSuccessMessage,
}: {
  actions?: QuickAction[] | null
  saveAction?: SaveQuickActionsAction
  saveSuccessMessage?: string
}) {
  const [items, setItems] = useState<QuickAction[]>(actions ?? DEFAULT_QUICK_ACTIONS)
  const [editorOpen, setEditorOpen] = useState(false)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100 ring-inset dark:bg-teal-950/50 dark:text-teal-300">
            <Zap size={14} />
          </span>
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_05968e045e405d" />
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="no-drag inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-teal-300"
        >
          <Settings2 size={13} />
          <GeneratedText id="m_0259e837087d9b" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <GeneratedValue
          value={
            items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_1b3e4c93cad8d7" />
                </p>
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:bg-teal-100 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/40"
                >
                  <Settings2 size={13} />
                  <GeneratedText id="m_1e4dd737605a31" />
                </button>
              </div>
            ) : (
              <div
                className="grid h-full min-h-0 auto-rows-fr gap-2 p-2.5"
                // `min(100%, …)` keeps a single column from overflowing on very narrow
                // cards; otherwise auto-fit packs as many ~10rem tiles as the width allows.
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10rem), 1fr))' }}
              >
                <GeneratedValue
                  value={items.map((a, i) => (
                    <ActionTile key={a.id} action={a} index={i} />
                  ))}
                />
              </div>
            )
          }
        />
      </div>

      <QuickActionsEditor
        open={editorOpen}
        value={items}
        onClose={() => setEditorOpen(false)}
        onSaved={(next) => setItems(next)}
        saveAction={saveAction}
        saveSuccessMessage={saveSuccessMessage}
      />
    </div>
  )
}

function ActionTile({ action, index }: { action: QuickAction; index: number }) {
  const t = toneOf(action.tone)
  const Icon = QUICK_ACTION_ICONS[action.iconKey] ?? FALLBACK_ICON
  const external = isExternalHref(action.href)

  const inner = (
    <>
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${t.chip}`}
      >
        <Icon size={14} />
      </span>
      <span
        className={`min-w-0 flex-1 text-left text-[13px] leading-snug font-medium transition-colors ${t.label}`}
      >
        <GeneratedValue value={action.label} />
      </span>
      <ArrowUpRight
        size={14}
        className={`shrink-0 translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 ${t.arrow}`}
      />
    </>
  )

  const className = `group flex h-full min-h-0 w-full items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-1.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none dark:focus-visible:ring-offset-slate-900 ${t.tile}`

  return (
    <motion.div
      className="min-h-0"
      // Transform-only entrance (no opacity) so a tile is never stranded
      // invisible if the animation can't run (e.g. a backgrounded tab) —
      // this is a primary CTA card, it must always render its content.
      initial={{ y: 8 }}
      animate={{ y: 0 }}
      transition={{ delay: 0.04 + index * 0.035, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <GeneratedValue
        value={
          external ? (
            <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
              <GeneratedValue value={inner} />
            </a>
          ) : (
            <Link href={action.href as any} className={className}>
              <GeneratedValue value={inner} />
            </Link>
          )
        }
      />
    </motion.div>
  )
}
