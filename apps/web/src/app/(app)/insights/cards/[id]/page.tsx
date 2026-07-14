import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Download, Pencil } from 'lucide-react'
import { Button, PageHeader, cn } from '@beaconhs/ui'
import type { BhqlResult } from '@beaconhs/analytics'
import { runAuthorizedBhql } from '@/lib/analytics-access'
import { requireRequestContext } from '@/lib/auth'
import { canPublishInsights, canViewInsights } from '../../_access'
import { loadInsightRoleOptions } from '../../_visibility'
import { loadCard } from '../_data'
import { VizRenderer } from '../../_viz/viz-renderer.client'
import { AiCardView } from '../../_viz/ai-card-view.client'
import { CardToolbar } from '../_studio/card-toolbar.client'
import { isTrustedSystemCard } from '../../_system-cards'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')
  const card = await loadCard(ctx, id)
  if (!card) notFound()
  const canEdit = ctx.isSuperAdmin || card.createdBy === ctx.userId
  const canPublish = canPublishInsights(ctx)
  const roleOptions = canEdit && canPublish ? await loadInsightRoleOptions(ctx) : []

  const isAi = card.kind === 'ai'
  const aiPrompt = card.config?.kind === 'ai' ? card.config.prompt : undefined
  let result: BhqlResult | null = null
  let error: string | null = null
  if (!isAi) {
    try {
      result = await runAuthorizedBhql(ctx, card.query, {
        maxRows: 50_000,
        trustedSystemCard: isTrustedSystemCard(card),
      })
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not run this card.'
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title={card.name}
        description={card.description ?? undefined}
        back={{ href: '/insights/library', label: 'Library' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                card.status === 'published'
                  ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {card.status === 'published' ? 'Published' : 'Draft'}
            </span>
            {/* Plain <a>, NOT <Link>: the export is a route handler and Link
                prefetch would fire real (audited) exports on every page view. */}
            <a href={`/insights/cards/${card.id}/export`}>
              <Button type="button" variant="outline" className="h-9 text-xs">
                <Download size={13} className="mr-1" /> CSV
              </Button>
            </a>
            {canEdit ? (
              <>
                <Link href={`/insights/cards/${card.id}/edit`}>
                  <Button type="button" variant="outline" className="h-9 text-xs">
                    <Pencil size={13} className="mr-1" /> Edit
                  </Button>
                </Link>
                <CardToolbar
                  id={card.id}
                  status={card.status}
                  canPublish={canPublish}
                  roles={roleOptions}
                  allowedRoles={card.allowedRoles}
                />
              </>
            ) : null}
          </div>
        }
      />
      <div className="h-[72vh] rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        {isAi ? (
          <AiCardView cardId={card.id} prompt={aiPrompt} />
        ) : error ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-rose-300 bg-rose-50/40 px-4 text-center text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/5 dark:text-rose-400">
            {error}
          </div>
        ) : result ? (
          <VizRenderer
            vizType={card.vizType}
            result={result}
            settings={card.vizSettings}
            label={card.name}
          />
        ) : null}
      </div>
    </div>
  )
}
