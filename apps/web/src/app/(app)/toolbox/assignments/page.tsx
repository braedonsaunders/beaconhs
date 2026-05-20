import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { CalendarClock } from 'lucide-react'
import { and, asc, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm'
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
import {
  orgUnits,
  people,
  roles,
  toolboxJournalAssignmentDispatches,
  toolboxJournalAssignments,
  toolboxJournals,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { ToolboxSubNav } from '@/components/toolbox-sub-nav'
import { computeAssignmentCompliance } from './_compliance'
import { ToolboxAssignmentsDrawers } from './_drawers'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Toolbox assignments' }

type Audience = {
  roleKeys: string[]
  personIds: string[]
  orgUnitIds: string[]
}

async function createAssignmentAction(input: {
  name: string
  description: string | null
  cron: string
  dueOffsetDays: number
  compliantPercentage: number
  active: boolean
  audience: Audience
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(toolboxJournalAssignments)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: input.description,
        cron: input.cron,
        dueOffsetDays: input.dueOffsetDays,
        compliantPercentage: input.compliantPercentage,
        active: input.active,
        audience: input.audience,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning(),
  )
  if (!row) {
    return { ok: false, error: 'Failed to create assignment' }
  }
  await recordAudit(ctx, {
    entityType: 'toolbox_journal_assignment',
    entityId: row.id,
    action: 'create',
    summary: `Created assignment "${name}"`,
    after: {
      name,
      cron: input.cron,
      audience: input.audience,
      active: input.active,
      compliantPercentage: input.compliantPercentage,
    },
  })
  revalidatePath('/toolbox/assignments')
  return { ok: true, id: row.id }
}

export default async function ToolboxAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const aRows = await tx
      .select({
        a: toolboxJournalAssignments,
        dispatchCount: sql<number>`(SELECT COUNT(*) FROM ${toolboxJournalAssignmentDispatches}
                 WHERE ${toolboxJournalAssignmentDispatches.assignmentId} = ${toolboxJournalAssignments.id})`,
      })
      .from(toolboxJournalAssignments)
      .orderBy(asc(toolboxJournalAssignments.name))

    // Compliance per assignment (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const compliance = await Promise.all(
      aRows.map(async ({ a }) => {
        const res = await computeAssignmentCompliance(tx, ctx.tenantId, a, since)
        return { id: a.id, compliance: res.percent }
      }),
    )
    const byId = Object.fromEntries(compliance.map((c) => [c.id, c.compliance]))
    return aRows.map((row) => ({
      ...row,
      compliancePct: byId[row.a.id] ?? null,
    }))
  })

  // Drawer audience options
  const [roleOptions, peopleOptions, siteOptions] = await ctx.db(async (tx) => {
    const r = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    const p = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return [r, p, s] as const
  })

  const openDrawer = pickString(sp.drawer) === 'new-assignment' ? 'new-assignment' : null

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Toolbox assignments"
            description="Recurring rules that require certain people, roles, or sites to log a toolbox talk on a cadence."
            actions={
              <Link href="/toolbox/assignments?drawer=new-assignment" scroll={false}>
                <Button>New assignment</Button>
              </Link>
            }
          />
          <ToolboxSubNav active="assignments" />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={32} />}
          title="No toolbox assignments yet"
          description="Create an assignment to require a foreman, role, or site to log a toolbox talk on a schedule."
          action={
            <Link href="/toolbox/assignments?drawer=new-assignment" scroll={false}>
              <Button>Create your first assignment</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead className="text-right">Dispatches</TableHead>
              <TableHead className="text-right">30d compliance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ a, dispatchCount, compliancePct }) => {
              const audienceSummary = describeAudience(a.audience)
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/toolbox/assignments/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.description ? (
                      <div className="text-xs text-slate-500">{a.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.cron}</TableCell>
                  <TableCell className="text-xs text-slate-600">{audienceSummary}</TableCell>
                  <TableCell className="text-right">{Number(dispatchCount ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    {compliancePct == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span
                        className={
                          compliancePct >= a.compliantPercentage
                            ? 'font-medium text-green-700'
                            : 'font-medium text-red-700'
                        }
                      >
                        {compliancePct.toFixed(0)}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <ToolboxAssignmentsDrawers
        openDrawer={openDrawer}
        closeHref="/toolbox/assignments"
        roleOptions={roleOptions}
        peopleOptions={peopleOptions}
        siteOptions={siteOptions}
        createAssignmentAction={createAssignmentAction}
      />
    </ListPageLayout>
  )
}

function describeAudience(audience: {
  roleKeys?: string[]
  personIds?: string[]
  orgUnitIds?: string[]
}): string {
  const parts: string[] = []
  if (audience.roleKeys?.length) parts.push(`${audience.roleKeys.length} role(s)`)
  if (audience.personIds?.length) parts.push(`${audience.personIds.length} person(s)`)
  if (audience.orgUnitIds?.length) parts.push(`${audience.orgUnitIds.length} site(s)`)
  return parts.length === 0 ? 'Everyone' : parts.join(' · ')
}
