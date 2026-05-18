import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { desc } from 'drizzle-orm'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import { incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Incidents' }

export default async function IncidentsPage() {
  const ctx = await requireRequestContext()
  if (ctx.isSuperAdmin) return <EmptyState icon={<AlertTriangle />} title="Pick a tenant" />
  const rows = await ctx.db((tx) =>
    tx.select().from(incidents).orderBy(desc(incidents.occurredAt)).limit(50),
  )
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="text-sm text-slate-500">Reports, investigations, and closeouts.</p>
        </div>
        <Link href="/incidents/new">
          <Button>Report incident</Button>
        </Link>
      </header>
      {rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle size={32} />}
          title="No incidents reported"
          description="When a worker reports an injury, illness, or near-miss it shows up here."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((i) => (
            <li key={i.id} className="flex items-center justify-between p-4">
              <div>
                <Link href={`/incidents/${i.id}`} className="font-medium hover:underline">
                  {i.reference} · {i.title}
                </Link>
                <div className="text-xs text-slate-500">
                  {i.type} · {new Date(i.occurredAt).toLocaleDateString()}
                </div>
              </div>
              <Badge variant={severityVariant(i.severity)}>{i.severity}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function severityVariant(s: string) {
  switch (s) {
    case 'fatality':
    case 'lost_time':
      return 'destructive' as const
    case 'medical_aid':
      return 'warning' as const
    case 'first_aid_only':
      return 'secondary' as const
    default:
      return 'outline' as const
  }
}
