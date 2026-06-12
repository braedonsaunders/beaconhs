import Link from 'next/link'
import { Users } from 'lucide-react'
import { asc, count } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { personGroupMemberships, personGroups } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'

export const metadata = { title: 'People — Groups' }
export const dynamic = 'force-dynamic'

export default async function GroupsPage() {
  const ctx = await requireModuleManage('people')
  const rows = await ctx.db(async (tx) => {
    const all = await tx.select().from(personGroups).orderBy(asc(personGroups.name))
    const counts = await tx
      .select({
        groupId: personGroupMemberships.groupId,
        c: count(),
      })
      .from(personGroupMemberships)
      .groupBy(personGroupMemberships.groupId)
    const countsById = new Map(counts.map((c) => [c.groupId, Number(c.c)]))
    return all.map((g) => ({ ...g, memberCount: countsById.get(g.id) ?? 0 }))
  })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="groups" />
          <PageHeader
            title="Groups"
            description="Tag arbitrary people with cross-cutting labels (JHSC members, fire wardens, first-aid responders, etc.)."
            actions={
              <Link href="/people/groups/new">
                <Button>Add group</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No groups"
          description="Flag people for emergency response, committee membership, or other cross-cutting groupings."
          action={
            <Link href="/people/groups/new">
              <Button>New group</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Members</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {g.color ? (
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-slate-200"
                        style={{ background: g.color }}
                        aria-hidden
                      />
                    ) : null}
                    <Link
                      href={`/people/groups/${g.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {g.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="text-slate-600">
                  {g.description ? <span className="line-clamp-2">{g.description}</span> : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{g.memberCount}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/people/groups/${g.id}`}
                    className="text-xs text-teal-700 hover:underline"
                  >
                    View →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
