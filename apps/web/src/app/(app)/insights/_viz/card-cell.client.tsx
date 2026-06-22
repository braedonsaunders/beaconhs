'use client'

// A dashboard cell that renders a Card (or a BHQL-backed built-in): server-
// compiled result + chosen viz. Scalar/progress viz self-render as their own KPI
// card (no double-wrap, no title row); everything else gets a titled shell with a
// link to the full Card (only when it's a real saved card, not a built-in key).

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { VizRenderer } from './viz-renderer.client'
import { AiCardView } from './ai-card-view.client'
import type { CardRender } from '../_data'

const UUID_RE = /^[0-9a-f-]{36}$/i

export function CardCell({ render }: { render: CardRender }) {
  const selfTitled = render.vizType === 'scalar' || render.vizType === 'progress'

  const body =
    render.kind === 'ai' ? (
      <AiCardView cardId={render.id} prompt={render.aiPrompt} />
    ) : render.error ? (
      <div className="grid h-full place-items-center px-2 text-center text-xs text-rose-500">
        {render.error}
      </div>
    ) : render.result ? (
      <VizRenderer
        vizType={render.vizType}
        result={render.result}
        settings={render.vizSettings}
        label={render.name}
      />
    ) : (
      <div className="grid h-full place-items-center text-xs text-slate-400">No data</div>
    )

  // Scalar/progress already render a complete, labelled KPI card.
  if (selfTitled && render.result && !render.error) {
    return <div className="h-full">{body}</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {render.name}
        </h3>
        {UUID_RE.test(render.id) ? (
          <Link
            href={`/insights/cards/${render.id}`}
            className="no-drag shrink-0 text-slate-300 transition hover:text-teal-600 dark:text-slate-600"
            title="Open card"
          >
            <ExternalLink size={13} />
          </Link>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}
