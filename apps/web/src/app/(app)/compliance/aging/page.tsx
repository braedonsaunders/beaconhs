import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0cb8c0baf11bf7') }
}
export const dynamic = 'force-dynamic'

const BUCKETS: { key: AgingBucket; label: string; tone: 'warning' | 'danger' }[] = [
  { key: '0_7', label: '0 – 7 days', tone: 'warning' },
  { key: '7_30', label: '7 – 30 days', tone: 'warning' },
  { key: '30_plus', label: '30+ days', tone: 'danger' },
  { key: 'no_date', label: 'No due date', tone: 'warning' },
]

export default async function AgingPage() {
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_096d47f60747b3')}
            description={tGenerated('m_1207a59962fc66')}
          />
          <ComplianceSubNav active="aging" />
        </>
      }
    >
      <div className="space-y-6">
        <GeneratedValue
          value={
            grandTotal === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <GeneratedText id="m_095bc36574daf6" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <GeneratedText id="m_1e578efe1574cd" />
                    </TableHead>
                    <GeneratedValue
                      value={BUCKETS.map((b) => (
                        <TableHead key={b.key}>
                          <GeneratedValue value={b.label} />
                        </TableHead>
                      ))}
                    />
                    <TableHead>
                      <GeneratedText id="m_13829da903be72" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={kindsWithItems.map((k) => (
                      <TableRow key={k}>
                        <TableCell>
                          <Badge variant="secondary">
                            <GeneratedValue value={kindLabel(k)} />
                          </Badge>
                        </TableCell>
                        <GeneratedValue
                          value={BUCKETS.map((b) => (
                            <TableCell key={b.key}>
                              <AgingCell count={matrix.get(`${k}::${b.key}`) ?? 0} tone={b.tone} />
                            </TableCell>
                          ))}
                        />
                        <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={totalByKind(k)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
            )
          }
        />
      </div>
    </ListPageLayout>
  )
}
