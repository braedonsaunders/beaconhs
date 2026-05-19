// "My toolbox talks" — talks where the user was the foreman OR an attendee.
//
// Foreman lookup uses tenant_users.id (foremanTenantUserId column). Attendee
// lookup goes through the toolbox_journal_attendees join table, which keys on
// people.id — so we resolve the user's person row up-front.
//
// We render two segmented sections (foreman / attended) since the relationship
// type matters at a glance and the rows are otherwise indistinguishable. Both
// use the same paging window for simplicity.

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
} from 'drizzle-orm'
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
  toolboxJournalAttendees,
  toolboxJournals,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { Pagination } from '@/components/pagination'
import { parseListParams } from '@/lib/list-params'

export const metadata = { title: 'My toolbox talks' }
export const dynamic = 'force-dynamic'

const TABS = ['foreman', 'attended'] as const
type Tab = (typeof TABS)[number]

export default async function MyToolboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab: Tab = pickActiveTab(sp, TABS, 'foreman')
  const params = parseListParams(sp, {
    sort: 'occurred_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: ['occurred_on'] as const,
  })

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    const personId = person?.id ?? null

    // ---- Tab counts (foreman & attended) ---------------------------------
    let foremanCount = 0
    if (membershipId) {
      const [r] = await tx
        .select({ c: count() })
        .from(toolboxJournals)
        .where(
          and(
            eq(toolboxJournals.foremanTenantUserId, membershipId),
            isNull(toolboxJournals.deletedAt),
          ),
        )
      foremanCount = Number(r?.c ?? 0)
    }
    let attendedCount = 0
    if (personId) {
      const [r] = await tx
        .select({ c: count() })
        .from(toolboxJournalAttendees)
        .where(eq(toolboxJournalAttendees.personId, personId))
      attendedCount = Number(r?.c ?? 0)
    }

    // ---- Active-tab rows ------------------------------------------------
    if (tab === 'foreman') {
      if (!membershipId) {
        return {
          personId,
          membershipId,
          foremanCount,
          attendedCount,
          rows: [] as any[],
          total: 0,
        }
      }
      const order =
        params.dir === 'asc'
          ? [asc(toolboxJournals.occurredOn)]
          : [desc(toolboxJournals.occurredOn)]
      const rows = await tx
        .select({ j: toolboxJournals, site: orgUnits })
        .from(toolboxJournals)
        .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
        .where(
          and(
            eq(toolboxJournals.foremanTenantUserId, membershipId),
            isNull(toolboxJournals.deletedAt),
          ),
        )
        .orderBy(...order)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)
      return {
        personId,
        membershipId,
        foremanCount,
        attendedCount,
        rows,
        total: foremanCount,
      }
    }
    // tab === 'attended'
    if (!personId) {
      return {
        personId,
        membershipId,
        foremanCount,
        attendedCount,
        rows: [] as any[],
        total: 0,
      }
    }
    const attendeeJournalIdsRaw = await tx
      .selectDistinct({ id: toolboxJournalAttendees.journalId })
      .from(toolboxJournalAttendees)
      .where(eq(toolboxJournalAttendees.personId, personId))
    const journalIds = attendeeJournalIdsRaw.map((r) => r.id)
    if (journalIds.length === 0) {
      return {
        personId,
        membershipId,
        foremanCount,
        attendedCount,
        rows: [] as any[],
        total: 0,
      }
    }
    const where: SQL<unknown> = and(
      inArray(toolboxJournals.id, journalIds),
      isNull(toolboxJournals.deletedAt),
    ) as SQL<unknown>
    const [tot] = await tx
      .select({ c: count() })
      .from(toolboxJournals)
      .where(where)
    const order =
      params.dir === 'asc'
        ? [asc(toolboxJournals.occurredOn)]
        : [desc(toolboxJournals.occurredOn)]
    const rows = await tx
      .select({ j: toolboxJournals, site: orgUnits })
      .from(toolboxJournals)
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .where(where)
      .orderBy(...order)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return {
      personId,
      membershipId,
      foremanCount,
      attendedCount,
      rows,
      total: Number(tot?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My toolbox talks"
            description="Talks where you were the foreman or signed in as an attendee."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/toolbox">
                  <Button variant="outline">All toolbox talks</Button>
                </Link>
                <Link href="/toolbox/new">
                  <Button>New toolbox talk</Button>
                </Link>
              </div>
            }
          />
          <TabNav
            basePath="/my/toolbox"
            currentParams={sp}
            active={tab}
            tabs={[
              { key: 'foreman', label: 'As foreman', count: data.foremanCount },
              { key: 'attended', label: 'Attended', count: data.attendedCount },
            ]}
          />
        </>
      }
    >
      {data.rows.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={32} />}
          title={
            tab === 'foreman'
              ? 'You have not led any toolbox talks yet'
              : 'You have not signed in to any toolbox talks yet'
          }
          description={
            tab === 'foreman'
              ? 'Lead a talk from the toolbox section to start logging your crew briefings.'
              : 'Once a foreman captures your attendance on a talk, it will appear here.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(({ j, site }: any) => (
                <TableRow key={j.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/toolbox/${j.id}`} className="hover:underline">
                      {j.reference}
                    </Link>
                  </TableCell>
                  <TableCell>{j.occurredOn}</TableCell>
                  <TableCell>
                    <Link
                      href={`/toolbox/${j.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {j.title}
                    </Link>
                    {j.topic ? <div className="text-xs text-slate-500">{j.topic}</div> : null}
                  </TableCell>
                  <TableCell className="text-slate-700">{site?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        j.status === 'closed'
                          ? 'success'
                          : j.status === 'submitted'
                            ? 'default'
                            : 'secondary'
                      }
                    >
                      {j.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/my/toolbox"
            currentParams={sp}
            total={data.total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
