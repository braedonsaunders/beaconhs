import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
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
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  people,
  personDivisionMemberships,
  personDivisions,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { MemberPicker } from '../../_components/member-picker'
import {
  deleteDivision,
  setDivisionMembership,
  updateDivision,
} from '../../_actions/divisions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Division · ${id.slice(0, 8)}` }
}

export default async function DivisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(personDivisions)
      .where(eq(personDivisions.id, id))
      .limit(1)
    if (!row) return null
    const allDivisions = await tx
      .select()
      .from(personDivisions)
      .orderBy(asc(personDivisions.name))
    const candidates = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const members = await tx
      .select({ personId: personDivisionMemberships.personId })
      .from(personDivisionMemberships)
      .where(eq(personDivisionMemberships.divisionId, id))
    const parent = row.parentDivisionId
      ? allDivisions.find((d) => d.id === row.parentDivisionId) ?? null
      : null
    return {
      row,
      parent,
      children: allDivisions.filter((d) => d.parentDivisionId === id),
      candidatesForParent: allDivisions.filter((d) => d.id !== id),
      candidates,
      memberIds: members.map((m) => m.personId),
    }
  })
  if (!data) notFound()
  const { row, parent, children, candidatesForParent, candidates, memberIds } = data

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people/divisions', label: 'Back to divisions' }}
          title={row.name}
          subtitle={
            parent
              ? `Child of ${parent.name}${row.code ? ` · ${row.code}` : ''}`
              : row.code
                ? `Top-level · ${row.code}`
                : 'Top-level division'
          }
          actions={
            <form action={deleteDivision}>
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
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edit division</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={updateDivision} className="space-y-4">
                  <input type="hidden" name="id" value={row.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" name="name" defaultValue={row.name} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="code">Short code</Label>
                    <Input id="code" name="code" defaultValue={row.code ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="parentDivisionId">Parent division</Label>
                    <Select
                      id="parentDivisionId"
                      name="parentDivisionId"
                      defaultValue={row.parentDivisionId ?? ''}
                    >
                      <option value="">— Top-level —</option>
                      {candidatesForParent.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
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
                  <div className="flex justify-end">
                    <Button type="submit" size="sm">
                      Save details
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers size={14} />
                  Sub-divisions
                  <Badge variant="secondary">{children.length}</Badge>
                </CardTitle>
                <Link href={`/people/divisions/new?parent=${row.id}`}>
                  <Button size="sm" variant="outline">
                    <Plus size={12} />
                    Add child
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {children.length === 0 ? (
                  <p className="text-sm text-slate-500">No sub-divisions.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {children.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/people/divisions/${c.id}`}
                          className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50"
                        >
                          <span className="font-medium">{c.name}</span>
                          {c.code ? (
                            <span className="font-mono text-xs text-slate-500">
                              {c.code}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Members
                <Badge variant="secondary">{memberIds.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MemberPicker
                entityId={row.id}
                entityIdField="divisionId"
                candidates={candidates}
                initialMemberIds={memberIds}
                action={setDivisionMembership}
                emptyMembersLabel="No members yet. Move people from the left."
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
