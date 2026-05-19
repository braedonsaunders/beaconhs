import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { Button, Input, Label, PageHeader, Textarea } from '@beaconhs/ui'
import { documentManagementReviews } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New management review' }
export const dynamic = 'force-dynamic'

async function createReview(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  const periodStart = String(formData.get('periodStart') ?? '').trim() || null
  const periodEnd = String(formData.get('periodEnd') ?? '').trim()
  const nextReviewOn = String(formData.get('nextReviewOn') ?? '').trim() || null
  const discussionNotes = String(formData.get('discussionNotes') ?? '').trim() || null
  const decisions = String(formData.get('decisions') ?? '').trim() || null
  if (!title || !periodEnd) return

  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentManagementReviews)
      .values({
        tenantId: ctx.tenantId,
        title,
        periodStart,
        periodEnd,
        nextReviewOn,
        discussionNotes,
        decisions,
        chairedByTenantUserId: ctx.membership?.id ?? null,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: documentManagementReviews.id })
    if (!row) throw new Error('Failed to create management review')
    return row.id
  })
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'create',
    summary: `Recorded management review "${title}"`,
    after: { title, periodStart, periodEnd, nextReviewOn },
  })
  revalidatePath('/documents/management-reviews')
  redirect(`/documents/management-reviews/${id}`)
}

export default function NewManagementReviewPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New management review"
          description="Record the annual / scheduled review of the SH&S management system. After saving you can attach the documents that were reviewed and link to follow-up corrective actions."
          back={{ href: '/documents/management-reviews', label: 'Back to reviews' }}
        />
        <form
          action={createReview}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="e.g. 2026 Annual Management Review"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="periodStart">Period start</Label>
              <Input id="periodStart" name="periodStart" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodEnd">Period end *</Label>
              <Input id="periodEnd" name="periodEnd" type="date" required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nextReviewOn">Next review on</Label>
              <Input id="nextReviewOn" name="nextReviewOn" type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discussionNotes">Discussion notes</Label>
            <Textarea
              id="discussionNotes"
              name="discussionNotes"
              rows={5}
              placeholder="Summary of what the board discussed."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decisions">Decisions</Label>
            <Textarea
              id="decisions"
              name="decisions"
              rows={4}
              placeholder="Outcomes / sign-off — what was approved, deferred, escalated."
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/documents/management-reviews">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Save review</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
