import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { asc, desc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
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
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { DetailGrid } from '@/components/detail-grid'
import { ToolboxStatusBadge } from '../../_status-badge'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  return { title: `Toolbox transcript · ${personId.slice(0, 8)}` }
}

export default async function ToolboxTranscriptPage({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!person) return null

    const rows = await tx
      .select({
        att: toolboxJournalAttendees,
        j: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournalAttendees)
      .innerJoin(
        toolboxJournals,
        eq(toolboxJournals.id, toolboxJournalAttendees.journalId),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(toolboxJournalAttendees.personId, personId))
      .orderBy(desc(toolboxJournals.occurredOn))
    return { person, rows }
  })
  if (!data) notFound()
  const { person, rows } = data

  const totalAttended = rows.length
  const signedCount = rows.filter((r) => !!r.att.signatureDataUrl).length
  const actionItemRows = rows.filter((r) => r.j.actionItems && r.j.actionItems.trim().length > 0)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/toolbox/transcripts', label: 'Back to transcripts' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={person.jobTitle ?? 'Toolbox transcript'}
          badge={<Badge variant="secondary">{totalAttended} attended</Badge>}
          actions={
            <Link href={`/toolbox/transcripts/${personId}/pdf`} target="_blank">
              <Button variant="outline">
                <FileText size={14} /> PDF
              </Button>
            </Link>
          }
        />
      }
    >
      <div className="space-y-5">
        <Section title="Summary">
          <DetailGrid
            rows={[
              { label: 'Person', value: `${person.lastName}, ${person.firstName}` },
              { label: 'Job title', value: person.jobTitle ?? '—' },
              { label: 'Status', value: person.status },
              { label: 'Toolbox talks attended', value: totalAttended },
              { label: 'Signed for', value: `${signedCount} / ${totalAttended}` },
              {
                label: 'Action item entries',
                value: actionItemRows.length,
              },
            ]}
          />
        </Section>

        <Section title={`Attended toolbox talks (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title="No toolbox attendance yet"
              description="This person has not been signed in to a toolbox talk."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Foreman</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.att.id}>
                    <TableCell>{r.j.occurredOn}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/toolbox/${r.j.id}`}
                        className="hover:underline"
                      >
                        {r.j.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/toolbox/${r.j.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.j.title}
                      </Link>
                      {r.j.topic ? (
                        <div className="text-xs text-slate-500">{r.j.topic}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {r.foremanUser?.name ?? r.foremanMembership?.displayName ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.site?.name ?? '—'}</TableCell>
                    <TableCell>
                      <ToolboxStatusBadge status={r.j.status} />
                    </TableCell>
                    <TableCell>
                      {r.att.signatureDataUrl ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title={`Action items involving this person (${actionItemRows.length})`}>
          {actionItemRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No toolbox talks attended had action items recorded.
            </p>
          ) : (
            <ul className="space-y-3">
              {actionItemRows.map((r) => (
                <li key={r.att.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/toolbox/${r.j.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.j.reference} · {r.j.title}
                    </Link>
                    <span className="text-xs text-slate-500">{r.j.occurredOn}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {r.j.actionItems}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </DetailPageLayout>
  )
}
