import type { NextRequest } from 'next/server'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  CSV_EXPORT_QUERY_LIMIT,
  csvExportOverflowResponse,
  csvFilename,
  csvResponse,
} from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { listEntries } from '../_data'
import type { JournalDefinition, JournalFilters, JournalStatus } from '../_types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireExportContext()
  assertCan(ctx, 'journals.read.self')
  const sp = new URL(req.url).searchParams
  const get = (k: string) => sp.get(k) || undefined

  const filters: JournalFilters = {
    q: get('q'),
    site: get('site'),
    person: get('person'),
    tag: get('tag'),
    status: get('status') as JournalStatus | undefined,
    definition: get('definition') as JournalDefinition | undefined,
    from: get('from'),
    to: get('to'),
  }

  const rows = await listEntries(ctx, filters, { limit: CSV_EXPORT_QUERY_LIMIT })

  const overflow = csvExportOverflowResponse(rows.length)
  if (overflow) return overflow

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    action: 'export',
    summary: `Exported ${rows.length} journal${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: { format: 'csv' },
  })

  const columns = csvColumns([
    'Reference',
    'Date',
    'Title',
    'Author',
    'Location',
    'Type',
    'Status',
    'Tags',
    'Photos',
    'Summary',
  ])
  const selection = selectCsvColumns(sp, columns)

  return csvResponse({
    filename: csvFilename('journals'),
    headers: selection.headers,
    rows: rows.map((r) =>
      selection.project([
        r.reference,
        r.entryDate,
        r.title ?? '',
        r.authorName ?? '',
        r.siteName ?? '',
        r.definition,
        r.status,
        r.tags.join('; '),
        String(r.photoCount),
        r.snippet,
      ]),
    ),
  })
}
