import { Users } from 'lucide-react'
import { asc } from 'drizzle-orm'
import { EmptyState } from '@beaconhs/ui'
import { people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'People' }

export default async function PeoplePage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(people).orderBy(asc(people.lastName), asc(people.firstName)).limit(200),
  )
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">People</h1>
      <p className="text-sm text-slate-500">
        Workers, contractors, supervisors. Sync from NetSuite via the first-party plugin.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No people in this tenant"
          description="Import via CSV from Admin → Import, or enable the NetSuite plugin."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between p-4 text-sm">
              <span className="font-medium">
                {p.lastName}, {p.firstName}
              </span>
              <span className="text-slate-500">{p.employeeNo ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
