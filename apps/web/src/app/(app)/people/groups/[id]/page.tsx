import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Trash2, Users } from 'lucide-react'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Textarea,
} from '@beaconhs/ui'
import { people, personGroupMemberships, personGroups } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { MemberPicker } from '../../_components/member-picker'
import { deleteGroup, setGroupMembership, updateGroup } from '../../_actions/groups'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Group · ${id.slice(0, 8)}` }
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireModuleManage('people')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(personGroups).where(eq(personGroups.id, id)).limit(1)
    if (!row) return null
    // Addable people: active, not soft-deleted (the active-picker rule).
    const activePeople = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        status: people.status,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const members = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(eq(personGroupMemberships.groupId, id))
    const memberIds = members.map((m) => m.personId)
    // Existing members must render regardless of status, or an inactive /
    // terminated member is counted but impossible to see or remove.
    const memberPeople =
      memberIds.length > 0
        ? await tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              employeeNo: people.employeeNo,
              status: people.status,
            })
            .from(people)
            .where(inArray(people.id, memberIds))
            .orderBy(asc(people.lastName), asc(people.firstName))
        : []
    const byId = new Map(activePeople.map((p) => [p.id, p]))
    for (const p of memberPeople) byId.set(p.id, p)
    const candidates = Array.from(byId.values()).sort(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    )
    return { row, candidates, memberIds }
  })
  if (!data) notFound()
  const { row, candidates, memberIds } = data

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people/groups', label: 'Back to groups' }}
          title={row.name}
          subtitle={row.description ?? undefined}
          badge={
            row.color ? (
              <span
                className="inline-block h-4 w-4 rounded-full border border-slate-200"
                style={{ background: row.color }}
              />
            ) : null
          }
          actions={
            <form action={deleteGroup}>
              <input type="hidden" name="id" value={row.id} />
              <Button
                type="submit"
                variant="outline"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </form>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit group</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateGroup} className="space-y-4">
                <input type="hidden" name="id" value={row.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" name="name" defaultValue={row.name} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={4}
                    defaultValue={row.description ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="color">Colour</Label>
                  <Input
                    id="color"
                    name="color"
                    type="color"
                    defaultValue={row.color ?? '#0f766e'}
                    className="h-9 w-16 cursor-pointer p-0.5"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm">
                    Save details
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users size={16} />
                Members
                <Badge variant="secondary">{memberIds.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MemberPicker
                entityId={row.id}
                entityIdField="groupId"
                candidates={candidates}
                initialMemberIds={memberIds}
                action={setGroupMembership}
                emptyMembersLabel="No members. Move people from the left."
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current members</CardTitle>
          </CardHeader>
          <CardContent>
            {memberIds.length === 0 ? (
              <p className="text-sm text-slate-500">No members.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {candidates
                  .filter((c) => memberIds.includes(c.id))
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/people/${c.id}`}
                        className="block rounded border border-slate-200 px-3 py-2 hover:border-teal-400 hover:bg-teal-50 dark:border-slate-700 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {c.lastName}, {c.firstName}
                          </span>
                          {c.status !== 'active' ? (
                            <Badge variant="warning">{c.status}</Badge>
                          ) : null}
                        </div>
                        {c.employeeNo ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {c.employeeNo}
                          </div>
                        ) : null}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
