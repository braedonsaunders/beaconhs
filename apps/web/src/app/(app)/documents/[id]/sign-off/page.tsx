// Group sign-off sheet — a roomy, tablet-friendly page where a facilitator
// records ONE session against the document's published version and collects each
// attendee's signature on the device. Every signer writes their own
// document_acknowledgments row (with session_id), so the per-person compliance
// engine is satisfied exactly as for self-service acks.

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, PageHeader } from '@beaconhs/ui'
import type { SelectOption } from '@beaconhs/ui'
import {
  attachments,
  documentAcknowledgments,
  documentVersions,
  documents,
  people,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'
import { SignOffSheet, type SheetSigner } from './_sign-off-sheet'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Group sign-off' }

export default async function SignOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const resumeSessionId = pickString(sp.session) ?? null
  const backHref = `/documents/${id}?tab=acknowledgments`

  const ctx = await requireRequestContext()
  // Facilitator-only: the sign-off sheet loads the full active-people directory
  // and writes acks on behalf of others. Gate the render on documents.manage so
  // a read-only user can't reach the kiosk session or enumerate people.
  if (!can(ctx, 'documents.manage')) notFound()

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id, title: documents.title, key: documents.key })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1)
    if (!doc) return null

    const [pub] = await tx
      .select({ id: documentVersions.id, version: documentVersions.version })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const peopleRows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(sql`${people.deletedAt} is null and ${people.status} = 'active'`)
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(1000)

    let roster: SheetSigner[] = []
    if (resumeSessionId) {
      const rows = await tx
        .select({
          ackId: documentAcknowledgments.id,
          personId: documentAcknowledgments.personId,
          firstName: people.firstName,
          lastName: people.lastName,
          acknowledgedAt: documentAcknowledgments.acknowledgedAt,
          r2Key: attachments.r2Key,
        })
        .from(documentAcknowledgments)
        .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
        .leftJoin(attachments, eq(attachments.id, documentAcknowledgments.signatureAttachmentId))
        .where(eq(documentAcknowledgments.sessionId, resumeSessionId))
        .orderBy(asc(documentAcknowledgments.acknowledgedAt))
      roster = rows.map((r) => ({
        ackId: r.ackId,
        personId: r.personId,
        name: `${r.firstName} ${r.lastName}`.trim() || '(unnamed)',
        acknowledgedAt: r.acknowledgedAt.toISOString(),
        signatureUrl: r.r2Key ? publicUrl(r.r2Key) : null,
      }))
    }

    return { doc, pub: pub ?? null, peopleRows, roster }
  })

  if (!data) notFound()
  const { doc, pub, peopleRows, roster } = data

  const options: SelectOption[] = peopleRows.map((p) => ({
    value: p.id,
    label: `${p.firstName} ${p.lastName}`.trim(),
    hint: p.jobTitle ?? undefined,
  }))

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Group sign-off"
          description={`${doc.title} · ${doc.key}`}
          back={{ href: backHref, label: 'Back to document' }}
        />

        {!pub ? (
          <Alert variant="warning">
            <AlertTitle>Publish the document first</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>A document must have a published version before it can be acknowledged.</p>
              <Link href={backHref}>
                <Button variant="outline">
                  <ArrowLeft size={14} /> Back to document
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <SignOffSheet
            documentId={id}
            versionId={pub.id}
            versionNumber={pub.version}
            defaultTitle={doc.title}
            peopleOptions={options}
            initialRoster={roster}
            initialSessionId={resumeSessionId}
            backHref={backHref}
          />
        )}
      </div>
    </PageContainer>
  )
}
