// CSV export of a Card's result (flat or pivot), under the caller's RLS.

import { runBhql } from '@beaconhs/analytics/server'
import type { BhqlResult } from '@beaconhs/analytics'
import { requireRequestContext } from '@/lib/auth'
import { canViewInsights } from '../../../_access'
import { loadCard } from '../../_data'

export const dynamic = 'force-dynamic'

function cell(v: unknown): string {
  if (v === null || typeof v === 'undefined') return ''
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return new Response('Forbidden', { status: 403 })
  const card = await loadCard(ctx, id)
  if (!card) return new Response('Not found', { status: 404 })

  const result = await ctx.db((tx) => runBhql(tx, card.query, { maxRows: 50_000 }))
  const csv = toCsv(result)
  const filename =
    card.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'card'

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}
