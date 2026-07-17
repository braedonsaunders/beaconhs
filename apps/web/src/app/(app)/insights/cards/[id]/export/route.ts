// CSV / PDF export of a Card's live result, under the caller's RLS. PDFs use
// the same branded document renderer as reports and split wide pivots into
// readable sections. AI-card PDFs run the stored analysis on demand.

import type { BhqlResult } from '@beaconhs/analytics'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import { resolveReportLayout } from '@beaconhs/reports'
import { NextResponse, type NextRequest } from 'next/server'
import { runAuthorizedBhql } from '@/lib/analytics-access'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { canViewInsights } from '../../../_access'
import { loadCard } from '../../_data'
import { isTrustedSystemCard } from '../../../_system-cards'
import { isUuid } from '@/lib/list-params'
import { loadTenantBranding } from '../../../../reports/_run'
import { runInsightAiCard } from '../../../_ai-actions'
import { aiCardDocument, cardExportFilename, cardResultDocument } from './_document'

export const dynamic = 'force-dynamic'

function cell(v: unknown): string {
  if (v === null || typeof v === 'undefined' || v === 'missing') return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(result: BhqlResult): string {
  if (result.shape === 'flat') {
    const header = result.columns.map((c) => cell(c.label)).join(',')
    const rows = result.rows.map((r) => result.columns.map((c) => cell(r[c.key])).join(','))
    return [header, ...rows].join('\n')
  }
  const valueKey = result.valueMeasures[0]?.key
  const header = [
    ...result.rowDimensions.map((d) => d.label),
    ...result.columnKeys.map((k) => k.labels.join(' · ')),
  ]
    .map(cell)
    .join(',')
  const rows = result.rowKeys.map((rk, ri) => {
    const cells = result.columnKeys.map((_ck, ci) =>
      cell(valueKey ? (result.cells[ri]?.[ci]?.[valueKey] ?? '') : ''),
    )
    return [...rk.labels.map(cell), ...cells].join(',')
  })
  return [header, ...rows].join('\n')
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return new Response('Not found', { status: 404 })

  const ctx = await requireExportContext()
  if (!canViewInsights(ctx)) return new Response('Forbidden', { status: 403 })
  const card = await loadCard(ctx, id)
  if (!card) return new Response('Not found', { status: 404 })

  const format = req.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv'
  const filename = cardExportFilename(card.name)

  if (format === 'pdf') {
    const document =
      card.kind === 'ai'
        ? await (async () => {
            const analysis = await runInsightAiCard(card.id)
            if (!analysis.ok) return analysis
            return { ok: true as const, ...aiCardDocument(analysis.analysis, analysis.rowCount) }
          })()
        : {
            ok: true as const,
            ...cardResultDocument(
              await runAuthorizedBhql(ctx, card.query, {
                maxRows: 50_000,
                trustedSystemCard: isTrustedSystemCard(card),
              }),
            ),
          }

    if (!document.ok) {
      return NextResponse.json({ error: document.error }, { status: 422 })
    }

    const branding = await loadTenantBranding(ctx)
    const pdf = await renderReportPdf({
      tenantName: branding.name,
      tenantLogoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      reportName: card.name,
      dateRangeLabel: 'Live data snapshot',
      generatedAt: new Date(),
      summary: document.summary,
      groups: document.groups,
      layout: resolveReportLayout({
        paperSize: 'letter',
        orientation: 'landscape',
        marginMm: 10,
        density: 'compact',
      }),
    })
    await recordAudit(ctx, {
      entityType: 'insight_card',
      entityId: card.id,
      action: 'export',
      summary: `Exported Insights card "${card.name}" (${document.rowCount} rows) to PDF`,
      metadata: { format: 'pdf', rowCount: document.rowCount },
    })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}.pdf"`,
      },
    })
  }

  const result = await runAuthorizedBhql(ctx, card.query, {
    maxRows: 50_000,
    trustedSystemCard: isTrustedSystemCard(card),
  })
  const csv = toCsv(result)
  const rowCount = result.shape === 'flat' ? result.rows.length : result.rowKeys.length
  await recordAudit(ctx, {
    entityType: 'insight_card',
    entityId: card.id,
    action: 'export',
    summary: `Exported Insights card "${card.name}" (${rowCount} rows) to CSV`,
    metadata: { format: 'csv', rowCount },
  })

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}
