import { notFound } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { assertBoundedReportFilters, type ReportRuleGroup } from '@beaconhs/reports'
import { assertCan } from '@beaconhs/tenant'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { loadDefinitionById } from '../../../_definitions'
import { loadTenantBranding, runReportForViewer } from '../../../_run'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.read')
  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()
  const format = request.nextUrl.searchParams.get('format')
  const resolvedFormat = format === 'xlsx' || format === 'pdf' ? format : 'csv'
  let filters: ReportRuleGroup | null | undefined
  const filtersParam = request.nextUrl.searchParams.get('filters')
  if (filtersParam) {
    if (filtersParam.length > 65_536) {
      return NextResponse.json({ error: 'Report filters are too large.' }, { status: 400 })
    }
    try {
      const parsed: unknown = JSON.parse(filtersParam)
      assertBoundedReportFilters(parsed)
      filters = parsed as ReportRuleGroup
    } catch {
      return NextResponse.json({ error: 'Report filters are invalid.' }, { status: 400 })
    }
  }
  const groupByParam = request.nextUrl.searchParams.get('groupBy')
  const groupBy = groupByParam?.trim() || undefined
  if (groupBy && groupBy.length > 128) {
    return NextResponse.json({ error: 'Report grouping is invalid.' }, { status: 400 })
  }
  const run = await runReportForViewer(ctx, definition, {
    maxRows: 10_000,
    filters,
    groupBy,
  })
  if (run.error) return NextResponse.json({ error: run.error }, { status: 422 })

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: id,
    action: 'export',
    summary: `Exported "${definition.name}" to ${resolvedFormat.toUpperCase()}`,
    metadata: { format: resolvedFormat, rowCount: run.result.rowCount },
  })

  const filename = `${definition.slug}-${new Date().toISOString().slice(0, 10)}`
  if (resolvedFormat === 'csv') {
    return new NextResponse(toCsv(run.result), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}.csv"`,
      },
    })
  }
  if (resolvedFormat === 'xlsx') {
    const workbook = await toWorkbook(run.result, definition.name)
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${filename}.xlsx"`,
      },
    })
  }

  const branding = await loadTenantBranding(ctx)
  const pdf = await renderReportPdf({
    tenantName: branding.name,
    tenantLogoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    reportName: definition.name,
    dateRangeLabel: definition.description ?? '',
    generatedAt: new Date(),
    summary: run.result.summary,
    groups: run.result.groups,
    layout: definition.layout,
  })
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}.pdf"`,
    },
  })
}

type Result = Awaited<ReturnType<typeof runReportForViewer>>['result']

function toCsv(result: Result): string {
  const lines: string[] = []
  for (const group of result.groups) {
    lines.push(csvRow([group.title]))
    lines.push(csvRow(group.columns.map((column) => column.label)))
    for (const row of group.rows) {
      lines.push(csvRow(group.columns.map((column) => display(row[column.key]))))
    }
    lines.push('')
  }
  return `﻿${lines.join('\r\n')}`
}

function csvRow(values: string[]): string {
  return values
    .map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
    .join(',')
}

async function toWorkbook(result: Result, reportName: string): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BeaconHS'
  for (const [index, group] of result.groups.entries()) {
    const sheet = workbook.addWorksheet(sheetName(group.title || `Results ${index + 1}`))
    sheet.addRow([reportName])
    sheet.addRow([group.title])
    sheet.addRow([])
    const header = sheet.addRow(group.columns.map((column) => column.label))
    header.font = { bold: true }
    for (const row of group.rows) {
      sheet.addRow(group.columns.map((column) => display(row[column.key])))
    }
    sheet.views = [{ state: 'frozen', ySplit: 4 }]
    sheet.columns.forEach((column, columnIndex) => {
      const values = group.rows
        .slice(0, 200)
        .map((row) => display(row[group.columns[columnIndex]?.key ?? '']).length)
      column.width = Math.min(
        56,
        Math.max(10, group.columns[columnIndex]?.label.length ?? 0, ...values) + 2,
      )
    })
  }
  if (!result.groups.length) workbook.addWorksheet('Results')
  return workbook.xlsx.writeBuffer()
}

function display(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function sheetName(value: string): string {
  return (
    value
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31) || 'Results'
  )
}
