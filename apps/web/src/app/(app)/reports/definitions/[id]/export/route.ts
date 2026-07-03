// CSV / XLSX / PDF export of a report definition, executed live under the
// caller's tenant RLS scope (same engine as the viewer; rows are NOT
// viewer-capped — custom plans export up to their stored row limit). PDF uses
// the same branded renderer as scheduled email deliveries.

import { notFound } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { loadDefinitionById } from '../../../_definitions'
import { runReportForViewer } from '../../../_run'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.read')
  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()

  const url = new URL(req.url)
  const formatRaw = url.searchParams.get('format')
  const format = formatRaw === 'xlsx' ? 'xlsx' : formatRaw === 'pdf' ? 'pdf' : 'csv'
  const daysRaw = url.searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : null

  const run = await runReportForViewer(ctx, definition, { days, maxRows: 10_000 })
  if (run.error) {
    return NextResponse.json({ error: run.error }, { status: 422 })
  }

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: id,
    action: 'export',
    summary: `Exported "${definition.name}" to ${format.toUpperCase()} (${run.result.rowCount} rows)`,
    metadata: { format, rowCount: run.result.rowCount, rangeLabel: run.rangeLabel },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  const base = `${definition.slug}-${stamp}`

  if (format === 'csv') {
    const csv = buildCsv(run.result.groups, definition.name, run.rangeLabel)
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${base}.csv"`,
      },
    })
  }

  if (format === 'pdf') {
    const [tenant] = await withSuperAdmin(db, (tx) =>
      tx
        .select({ name: tenants.name, branding: tenants.branding })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1),
    )
    const pdf = await renderReportPdf({
      tenantName: tenant?.name ?? 'BeaconHS',
      tenantLogoUrl: tenant?.branding?.logoUrl ?? null,
      primaryColor: tenant?.branding?.primaryColor ?? null,
      reportName: definition.name,
      dateRangeLabel: run.rangeLabel,
      generatedAt: new Date(),
      summary: run.result.summary,
      groups: run.result.groups,
    })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${base}.pdf"`,
      },
    })
  }

  const buffer = await buildXlsx(run.result, definition.name, run.rangeLabel)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${base}.xlsx"`,
    },
  })
}

// --- CSV ---------------------------------------------------------------------

type Groups = Awaited<ReturnType<typeof runReportForViewer>>['result']['groups']

function buildCsv(groups: Groups, reportName: string, rangeLabel: string): string {
  const lines: string[] = [csvRow([reportName, rangeLabel]), '']
  for (const g of groups) {
    lines.push(csvRow([g.title + (g.subtitle ? ` — ${g.subtitle}` : '')]))
    lines.push(csvRow(g.columns))
    for (const row of g.rows) {
      lines.push(csvRow(row.map((c) => (c === null || typeof c === 'undefined' ? '' : String(c)))))
    }
    lines.push('')
  }
  // BOM so Excel opens UTF-8 correctly.
  return '﻿' + lines.join('\r\n')
}

function csvRow(cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c)
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(',')
}

// --- XLSX --------------------------------------------------------------------

async function buildXlsx(
  result: Awaited<ReturnType<typeof runReportForViewer>>['result'],
  reportName: string,
  rangeLabel: string,
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BeaconHS'
  wb.created = new Date()

  const seen = new Set<string>()
  const sheets = result.groups.length
    ? result.groups
    : [{ title: 'Results', columns: ['(empty)'], rows: [], subtitle: undefined, isEmpty: true }]

  for (const g of sheets) {
    const ws = wb.addWorksheet(sheetName(g.title, seen))
    ws.addRow([reportName])
    ws.addRow([g.title + (g.subtitle ? ` — ${g.subtitle}` : ''), rangeLabel])
    ws.addRow([])
    const header = ws.addRow(g.columns)
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
    })
    for (const row of g.rows) {
      ws.addRow(row.map((c) => (c === null || typeof c === 'undefined' ? '' : c)))
    }
    ws.getRow(1).font = { bold: true, size: 13 }
    ws.views = [{ state: 'frozen', ySplit: 4 }]
    ws.columns.forEach((col, i) => {
      let width = String(g.columns[i] ?? '').length
      for (const row of g.rows.slice(0, 200)) {
        width = Math.max(width, String(row[i] ?? '').length)
      }
      col.width = Math.min(Math.max(width + 2, 10), 56)
    })
  }

  return wb.xlsx.writeBuffer()
}

/** Excel sheet names: ≤31 chars, no \\/?*[]: and unique per workbook. */
function sheetName(title: string, seen: Set<string>): string {
  const cleaned =
    title
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 28) || 'Sheet'
  let name = cleaned
  let n = 2
  while (seen.has(name.toLowerCase())) name = `${cleaned} ${n++}`.slice(0, 31)
  seen.add(name.toLowerCase())
  return name
}
