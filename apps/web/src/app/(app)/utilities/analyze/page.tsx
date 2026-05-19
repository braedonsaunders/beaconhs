import Link from 'next/link'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { getTenantTableTotals, runAnalyzer } from './_lib'

export const metadata = { title: 'Data quality analyzer' }
export const dynamic = 'force-dynamic'

// The analyzer is read-only. Every visit writes an audit entry so admins can
// see who has been poking at the tenant's quality scores.

export default async function AnalyzePage() {
  const ctx = await requireRequestContext()
  const [findings, totals] = await Promise.all([
    runAnalyzer(ctx),
    getTenantTableTotals(ctx),
  ])
  await recordAudit(ctx, {
    entityType: 'data_quality',
    action: 'view_sensitive',
    summary: `Ran data-quality analyzer (${findings.length} checks)`,
    metadata: {
      totalsAtRun: totals,
      findings: findings.map((f) => ({ key: f.key, count: f.count })),
    },
  })

  const totalIssues = findings.reduce((s, f) => s + f.count, 0)

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Data quality analyzer"
          description="Server-side checks for missing or inconsistent data across the tenant."
          back={{ href: '/utilities', label: 'All utilities' }}
        />

        {totalIssues === 0 ? (
          <Alert>
            <AlertTitle>All checks passed</AlertTitle>
            <AlertDescription>
              No data-quality issues detected against the current set of checks.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>
              {totalIssues} item{totalIssues === 1 ? '' : 's'} flagged across {findings.filter((f) => f.count > 0).length}{' '}
              check{findings.filter((f) => f.count > 0).length === 1 ? '' : 's'}
            </AlertTitle>
            <AlertDescription>
              Reports and dashboards roll up the underlying records, so unflagged tenants
              get cleaner numbers. Click through each finding for the first ten affected
              rows and a link to the source list.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active people', value: totals.people },
            { label: 'Equipment items', value: totals.equipment },
            { label: 'Corrective actions', value: totals.correctiveActions },
            { label: 'Incidents', value: totals.incidents },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {findings.map((f) => (
            <Card key={f.key}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      {f.title}
                    </CardTitle>
                    <CardDescription>{f.description}</CardDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-3xl font-semibold ${
                        f.count === 0 ? 'text-slate-300' : 'text-slate-900'
                      }`}
                    >
                      {f.count}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      affected
                    </div>
                  </div>
                </div>
              </CardHeader>
              {f.count > 0 ? (
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {f.samples.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-slate-700">{s.label}</span>
                        <code className="ml-2 shrink-0 text-xs text-slate-400">{s.id.slice(0, 8)}</code>
                      </li>
                    ))}
                    {f.count > f.samples.length ? (
                      <li className="text-xs italic text-slate-500">
                        … and {f.count - f.samples.length} more.
                      </li>
                    ) : null}
                  </ul>
                  {f.sampleHref ? (
                    <div className="mt-3">
                      <Link href={f.sampleHref as any}>
                        <Button variant="outline" size="sm">
                          Open source list
                        </Button>
                      </Link>
                    </div>
                  ) : null}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}

function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  return (
    <Badge
      variant={
        severity === 'high' ? 'destructive' : severity === 'medium' ? 'warning' : 'secondary'
      }
    >
      {severity}
    </Badge>
  )
}
