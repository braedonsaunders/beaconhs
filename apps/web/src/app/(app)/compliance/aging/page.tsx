import {
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { type AgingBucket, agingFromStatus, kindLabel } from '../_hub'
import { AgingCell } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'
import { OBLIGATION_KINDS } from '../obligations/_meta'

export const metadata = { title: 'Compliance · Aging' }
export const dynamic = 'force-dynamic'

const BUCKETS: { key: AgingBucket; label: string; tone: 'warning' | 'danger' }[] = [
  { key: '0_7', label: '0 – 7 days', tone: 'warning' },
  { key: '7_30', label: '7 – 30 days', tone: 'warning' },
  { key: '30_plus', label: '30+ days', tone: 'danger' },
  { key: 'no_date', label: 'No due date', tone: 'warning' },
]

export default async function AgingPage() {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const rows = await agingFromStatus(ctx)

  const matrix = new Map<string, number>() // `${kind}::${bucket}` -> count
  for (const r of rows)
    matrix.set(`${r.kind}::${r.bucket}`, (matrix.get(`${r.kind}::${r.bucket}`) ?? 0) + r.count)
  const totalByKind = (kind: string) =>
    BUCKETS.reduce((s, b) => s + (matrix.get(`${kind}::${b.key}`) ?? 0), 0)
  const kindsWithItems = OBLIGATION_KINDS.filter((k) => totalByKind(k) > 0)
  const grandTotal = OBLIGATION_KINDS.reduce((s, k) => s + totalByKind(k), 0)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="Every overdue or expiring subject across all obligation kinds, grouped by age."
          />
          <ComplianceSubNav active="aging" />
        </>
      }
    >
      <div className="space-y-6">
        {grandTotal === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Nothing overdue or expiring — nice work.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                {BUCKETS.map((b) => (
                  <TableHead key={b.key}>{b.label}</TableHead>
                ))}
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kindsWithItems.map((k) => (
                <TableRow key={k}>
                  <TableCell>
                    <Badge variant="secondary">{kindLabel(k)}</Badge>
                  </TableCell>
                  {BUCKETS.map((b) => (
                    <TableCell key={b.key}>
                      <AgingCell count={matrix.get(`${k}::${b.key}`) ?? 0} tone={b.tone} />
                    </TableCell>
                  ))}
                  <TableCell className="font-semibold text-slate-900 dark:text-slate-100">{totalByKind(k)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </ListPageLayout>
  )
}
