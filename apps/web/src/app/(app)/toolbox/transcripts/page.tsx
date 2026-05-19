import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people, toolboxJournalAttendees } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { ToolboxSubNav } from '@/components/toolbox-sub-nav'
import { pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Toolbox transcripts' }

export default async function ToolboxTranscriptsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = pickString(sp.q)?.trim() ?? ''
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    // Aggregate attendance count per person, then join to people.
    const counts = await tx
      .select({
        personId: toolboxJournalAttendees.personId,
        c: count(),
      })
      .from(toolboxJournalAttendees)
      .groupBy(toolboxJournalAttendees.personId)
    const map = Object.fromEntries(counts.map((r) => [r.personId, Number(r.c)]))

    const filters: SQL<unknown>[] = [eq(people.status, 'active')]
    if (q) {
      filters.push(
        sql`(lower(${people.firstName}) like ${'%' + q.toLowerCase() + '%'}
             OR lower(${people.lastName}) like ${'%' + q.toLowerCase() + '%'})`,
      )
    }
    const p = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(and(...filters))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    return p.map((person) => ({ person, count: map[person.id] ?? 0 }))
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Toolbox transcripts"
            description="Per-person history: every toolbox talk where the individual was an attendee."
          />
          <ToolboxSubNav active="transcripts" />
          <form className="flex items-center gap-2" action="/toolbox/transcripts" method="get">
            <Input
              name="q"
              type="search"
              placeholder="Search by name…"
              defaultValue={q}
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No people match"
          description="Try a broader search, or add people in /people first."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Job title</TableHead>
              <TableHead className="text-right">Toolbox talks attended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ person, count }) => (
              <TableRow key={person.id}>
                <TableCell>
                  <Link
                    href={`/toolbox/transcripts/${person.id}`}
                    className="font-medium hover:underline"
                  >
                    {person.lastName}, {person.firstName}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-600">{person.jobTitle ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{count}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
