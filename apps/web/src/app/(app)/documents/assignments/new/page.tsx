import { asc, sql } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { departments, documents, people, roles, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { NewAssignmentForm } from './new-assignment-form'

export const metadata = { title: 'New document assignment' }
export const dynamic = 'force-dynamic'

export default async function NewAssignmentPage() {
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [docs, allRoles, allTrades, allDepts, allPeople] = await Promise.all([
      tx
        .select({ id: documents.id, title: documents.title, status: documents.status })
        .from(documents)
        .where(sql`${documents.deletedAt} is null`)
        .orderBy(asc(documents.title))
        .limit(500),
      tx
        .select({ key: roles.key, name: roles.name })
        .from(roles)
        .orderBy(asc(roles.name)),
      tx.select({ id: trades.id, name: trades.name }).from(trades).orderBy(asc(trades.name)),
      tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .orderBy(asc(departments.name)),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          jobTitle: people.jobTitle,
        })
        .from(people)
        .where(sql`${people.deletedAt} is null`)
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(1000),
    ])
    return { docs, allRoles, allTrades, allDepts, allPeople }
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="New document assignment"
          description="Require a group of workers to acknowledge a specific document. Compliance is computed automatically from acknowledgements."
          back={{ href: '/documents/assignments', label: 'Back to assignments' }}
        />
        <NewAssignmentForm
          documents={data.docs.map((d) => ({
            id: d.id,
            label: d.title,
            sub: d.status,
          }))}
          roles={data.allRoles}
          trades={data.allTrades.map((t) => ({ id: t.id, label: t.name }))}
          departments={data.allDepts.map((d) => ({ id: d.id, label: d.name }))}
          people={data.allPeople.map((p) => ({
            id: p.id,
            label: `${p.firstName} ${p.lastName}`,
            sub: p.jobTitle ?? undefined,
          }))}
        />
      </div>
    </PageContainer>
  )
}
