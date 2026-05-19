// Tiny CSV emitter for list-page exports. RFC 4180-style: comma separator,
// CRLF terminators, fields containing comma/quote/newline are quoted with
// internal quotes doubled.
//
// Returns a NextResponse with text/csv mime type and a Content-Disposition
// attachment header so browsers prompt a download.

import { NextResponse } from 'next/server'

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    })
    .join(',')
}

export function csvResponse(args: {
  filename: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}): NextResponse {
  const lines = [csvRow(args.headers), ...args.rows.map((r) => csvRow(r))]
  const body = lines.join('\r\n') + '\r\n'
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${args.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

export function csvFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${prefix}-${stamp}.csv`
}
