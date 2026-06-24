import type { NextRequest } from 'next/server'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { listEntries } from '../_data'
import type { JournalDefinition, JournalFilters, JournalStatus } from '../_types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireExportContext()
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

  const rows = await listEntries(ctx, filters, { limit: 5000 })

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    action: 'export',
    summary: `Exported ${rows.length} journal${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: { format: 'csv' },
  })

  return csvResponse({
    filename: csvFilename('journals'),
    headers: [
      'Reference',
      'Date',
      'Title',
      'Author',
      'Site',
      'Type',
      'Status',
      'Tags',
      'Photos',
      'Summary',
    ],
    rows: rows.map((r) => [
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
  })
}
