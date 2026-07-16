import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { documentAcknowledgmentSessions } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'

export default async function DocumentSignoffSessionRedirect({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  if (!isUuid(sessionId)) notFound()
  const ctx = await requireRequestContext()
  const [session] = await ctx.db((tx) =>
    tx
      .select({ documentId: documentAcknowledgmentSessions.documentId })
      .from(documentAcknowledgmentSessions)
      .where(
        and(
          eq(documentAcknowledgmentSessions.id, sessionId),
          isNull(documentAcknowledgmentSessions.deletedAt),
        ),
      )
      .limit(1),
  )
  if (!session) notFound()
  redirect(`/documents/${session.documentId}/sign-off?session=${sessionId}`)
}
