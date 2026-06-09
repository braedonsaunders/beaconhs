import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { eq } from 'drizzle-orm'
import {
  Badge,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { DetailGrid } from '@/components/detail-grid'
import { loadPersonTranscript } from '../../_lib/participants'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  return { title: `Form transcript · ${personId.slice(0, 8)}` }
}

export default async function FormTranscriptPage({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  const ctx = await requireRequestContext()

  const person = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, personId)).limit(1)
    return p ?? null
  })
  if (!person) notFound()

  const transcript = await loadPersonTranscript(ctx, personId)
  const { rows, totals } = transcript
  const categories = Object.entries(totals.byCategory)
    .map(([k, n]) => `${k} (${n})`)
    .join(', ')

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/forms/transcripts', label: 'Back to transcripts' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={person.jobTitle ?? 'Form transcript'}
          badge={<Badge variant="secondary">{totals.responses} forms</Badge>}
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
              { label: 'Forms participated in', value: totals.responses },
              { label: 'Signed for', value: `${totals.signed} / ${totals.responses}` },
              { label: 'By category', value: categories || '—' },
            ]}
          />
        </Section>

        <Section title={`Forms (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title="No form participation yet"
              description="This person has not appeared on a submitted form."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.participantId}>
                    <TableCell>{r.occurredOn ?? '—'}</TableCell>
                    <TableCell>
                      <Link
                        href={`/forms/responses/${r.responseId}`}
                        className="font-medium hover:underline"
                      >
                        {r.templateName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{r.category ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{r.status}</TableCell>
                    <TableCell>
                      {r.signed ? (
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
      </div>
    </DetailPageLayout>
  )
}
