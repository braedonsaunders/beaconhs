import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { DownloadLink } from '@/components/download-link'
import { notFound, redirect } from 'next/navigation'
import { Download, FileText, Pencil } from 'lucide-react'
import { Button, PageHeader, cn } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
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
import {
  applyMatrixFilterRules,
  MATRIX_FILTER_PARAM,
  matrixSource,
  parseMatrixFilters,
} from '../../_matrix-filter-values'
import { loadMatrixSelections } from '../../_matrix-filters'
import { MatrixFilterButton } from '../../_matrix-filters.client'

export const dynamic = 'force-dynamic'

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')
  const card = await loadCard(ctx, id)
  if (!card) notFound()
  const canEdit = ctx.isSuperAdmin || card.createdBy === ctx.userId
  const canPublish = canPublishInsights(ctx)
  const canExport = can(ctx, 'admin.data.export') && !ctx.impersonation
  const roleOptions = canEdit && canPublish ? await loadInsightRoleOptions(ctx) : []

  const search = await searchParams
  const matrix = matrixSource(card.query)
  const tableKey = `matrix_${card.id}`
  const peopleSearch = search[`${tableKey}_q`]
  const exportParams = new URLSearchParams()
  for (const key of [MATRIX_FILTER_PARAM, `${tableKey}_q`]) {
    if (typeof search[key] === 'string') exportParams.set(key, search[key])
  }
  const exportHref = `/insights/cards/${card.id}/export${exportParams.size ? `?${exportParams}` : ''}`
  let selections = await loadMatrixSelections(ctx, card.query, parseMatrixFilters())
  const isAi = card.kind === 'ai'
  const aiPrompt = card.config?.kind === 'ai' ? card.config.prompt : undefined
  let result: BhqlResult | null = null
  let error: string | null = null
  if (!isAi) {
    try {
      const filters = matrix
        ? parseMatrixFilters(
            typeof search[MATRIX_FILTER_PARAM] === 'string'
              ? search[MATRIX_FILTER_PARAM]
              : undefined,
          )
        : parseMatrixFilters()
      if (matrix) selections = await loadMatrixSelections(ctx, card.query, filters)
      const query = matrix
        ? applyMatrixFilterRules(
            card.query,
            filters,
            typeof peopleSearch === 'string' ? peopleSearch : '',
          )
        : card.query
      result = await runAuthorizedBhql(ctx, query, {
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
        title={tGeneratedValue(card.name)}
        description={tGeneratedValue(card.description ?? undefined)}
        back={{ href: '/insights/library', label: 'Library' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {matrix ? (
              <MatrixFilterButton
                cardId={card.id}
                skillMatrix={matrix === 'skill_coverage'}
                selected={selections}
              />
            ) : null}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                card.status === 'published'
                  ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              <GeneratedValue
                value={
                  card.status === 'published' ? (
                    <GeneratedText id="m_0a65097103ae1b" />
                  ) : (
                    <GeneratedText id="m_13f3db1d0ca2fe" />
                  )
                }
              />
            </span>
            <GeneratedValue
              value={
                canExport ? (
                  <>
                    <DownloadLink href={`${exportHref}${exportParams.size ? '&' : '?'}format=pdf`}>
                      <Button type="button" variant="outline" className="h-9 text-xs">
                        <FileText size={13} className="mr-1" />{' '}
                        <GeneratedText id="m_1a2b2ed6729166" />
                      </Button>
                    </DownloadLink>
                    <DownloadLink href={exportHref}>
                      <Button type="button" variant="outline" className="h-9 text-xs">
                        <Download size={13} className="mr-1" />{' '}
                        <GeneratedText id="m_13bc18467bfb44" />
                      </Button>
                    </DownloadLink>
                  </>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canEdit ? (
                  <>
                    <Link href={`/insights/cards/${card.id}/edit`}>
                      <Button type="button" variant="outline" className="h-9 text-xs">
                        <Pencil size={13} className="mr-1" />{' '}
                        <GeneratedText id="m_03a66f9d34ac7b" />
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
                ) : null
              }
            />
          </div>
        }
      />
      <div className="h-[72vh] rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <GeneratedValue
          value={
            isAi ? (
              <AiCardView cardId={card.id} prompt={tGeneratedValue(aiPrompt)} />
            ) : error ? (
              <div className="grid h-full place-items-center rounded-lg border border-dashed border-rose-300 bg-rose-50/40 px-4 text-center text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/5 dark:text-rose-400">
                <GeneratedValue value={error} />
              </div>
            ) : result ? (
              <VizRenderer
                tableKey={tableKey}
                vizType={card.vizType}
                result={result}
                settings={card.vizSettings}
                label={tGeneratedValue(card.name)}
              />
            ) : null
          }
        />
      </div>
    </div>
  )
}
