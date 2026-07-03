// Tiny CSV emitter for list-page exports. RFC 4180-style: comma separator,
// CRLF terminators, fields containing comma/quote/newline are quoted with
// internal quotes doubled. String fields starting with a formula trigger
// (=, +, -, @, tab, CR) are prefixed with an apostrophe so Excel/Sheets treat
// user-entered text as a literal instead of executing it.
//
// Returns a NextResponse with text/csv mime type and a Content-Disposition
// attachment header so browsers prompt a download.

import { NextResponse } from 'next/server'

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return ''
      let s = String(v)
      // Formula-injection hardening. Real numbers pass through untouched so
      // negative values stay numeric; only text fields are neutralised.
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
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
