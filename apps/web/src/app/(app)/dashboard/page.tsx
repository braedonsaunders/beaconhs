import { AlertTriangle, ClipboardCheck, GraduationCap, ListChecks } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import {
  correctiveActions,
  formResponses,
  incidents,
  trainingRecords,
} from '@beaconhs/db/schema'
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const ctx = await requireRequestContext()
  const stats = await ctx.db(async (tx) => {
    const thirty = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const ninety = new Date(Date.now() + 90 * 24 * 3600 * 1000)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [incRow] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(gte(incidents.occurredAt, thirty))
    const [caRow] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(and(isNull(correctiveActions.closedAt)))
    const [subRow] = await tx
      .select({ c: count() })
      .from(formResponses)
      .where(gte(formResponses.submittedAt, todayStart))
    const [certRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          sql`expires_on IS NOT NULL`,
          sql`expires_on <= ${ninety.toISOString().slice(0, 10)}`,
        ),
      )
    return {
      incidents: Number(incRow?.c ?? 0),
      openCAs: Number(caRow?.c ?? 0),
      submissionsToday: Number(subRow?.c ?? 0),
      expiringCerts: Number(certRow?.c ?? 0),
    }
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Drag-drop widget builder lands in Phase 4 — these are the default tiles.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Incidents (30d)" value={stats.incidents} icon={<AlertTriangle size={18} />} />
        <StatTile label="Open corrective actions" value={stats.openCAs} icon={<ListChecks size={18} />} />
        <StatTile label="Submissions today" value={stats.submissionsToday} icon={<ClipboardCheck size={18} />} />
        <StatTile label="Certs expiring (90d)" value={stats.expiringCerts} icon={<GraduationCap size={18} />} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>What's next</CardTitle>
          <CardDescription>
            The widget builder, form builder, and module screens are scaffolded — wire up real data per
            REWRITE_PLAN.md.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            <li>Build the form designer (Phase 1)</li>
            <li>Build the form renderer with autosave + drafts (Phase 1)</li>
            <li>Wire up incident reporting flow (Phase 3)</li>
            <li>Build the dashboard widget builder (Phase 4)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{label}</span>
          <span className="text-slate-400">{icon}</span>
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}
