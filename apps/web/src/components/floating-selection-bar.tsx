'use client'

// The bar that floats at the bottom of a list once rows are selected: clear
// button, "N … selected", then the list's own actions. It only exists while
// something is selected, so it never pushes the table around.
//
// Portaled to <body>: PageContainer's FadeInBody transform would otherwise
// capture position:fixed and pin the bar to the container, not the viewport.

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import { useHydrated } from '@/lib/use-hydrated'

export function FloatingSelectionBar({
  label,
  onClear,
  clearDisabled,
  children,
}: {
  /** e.g. "3 incidents selected" */
  label: string
  onClear: () => void
  clearDisabled?: boolean
  /** The list's actions. */
  children: ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const mounted = useHydrated()
  if (!mounted) return null
  return createPortal(
    <div className="fixed bottom-4 left-1/2 z-40 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClear}
          aria-label={tGenerated('m_1013583a7c0e28')}
          disabled={clearDisabled}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          <GeneratedValue value={label} />
        </span>
        {children}
      </div>
    </div>,
    document.body,
  )
}
