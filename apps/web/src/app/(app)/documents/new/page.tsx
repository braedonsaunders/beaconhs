import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import {
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { documentVersions, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New document' }

const CATEGORIES = [
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure / SOP' },
  { value: 'sds', label: 'Safety data sheet (SDS / MSDS)' },
  { value: 'form', label: 'Form / template' },
  { value: 'manual', label: 'Manual / handbook' },
  { value: 'training', label: 'Training material' },
  { value: 'other', label: 'Other' },
]

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function createDocument(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const customKey = String(formData.get('key') ?? '').trim() || null
  const reviewFrequencyMonthsRaw = String(formData.get('reviewFrequencyMonths') ?? '').trim()
  const reviewFrequencyMonths = reviewFrequencyMonthsRaw ? Number(reviewFrequencyMonthsRaw) : null
  const contentMarkdown = String(formData.get('contentMarkdown') ?? '').trim() || null
  if (!title) return

  const key = customKey ? slugify(customKey) : `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`

  const nextReviewOn = reviewFrequencyMonths
    ? (() => {
        const d = new Date()
        d.setMonth(d.getMonth() + reviewFrequencyMonths)
        return d.toISOString().slice(0, 10)
      })()
    : null

  const documentId = await ctx.db(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: ctx.tenantId,
        key,
        title,
        description,
        category,
        status: 'draft',
        reviewFrequencyMonths,
        nextReviewOn,
      })
      .returning({ id: documents.id })
    if (!doc) throw new Error('Failed to insert document')
    await tx.insert(documentVersions).values({
      tenantId: ctx.tenantId,
      documentId: doc.id,
      version: 1,
      contentMarkdown,
    })
    return doc.id
  })

  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'create',
    summary: `Created document "${title}"`,
    after: { title, key, category, reviewFrequencyMonths },
  })
  revalidatePath('/documents')
  redirect(`/documents/${documentId}`)
}

export default function NewDocumentPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New document"
          description="Create a draft document. You can edit content + publish from the detail page; published docs can be acknowledged by workers and re-reviewed on a cadence."
          back={{ href: '/documents', label: 'Back to documents' }}
        />
        <form action={createDocument} className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required placeholder="e.g. Working at Heights Policy" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue="policy">
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reviewFrequencyMonths">Review every (months)</Label>
              <Input
                id="reviewFrequencyMonths"
                name="reviewFrequencyMonths"
                type="number"
                min="1"
                placeholder="12"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="key">Key (optional)</Label>
            <Input id="key" name="key" placeholder="auto-generated from title if blank" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Short description</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contentMarkdown">Content (markdown)</Label>
            <Textarea
              id="contentMarkdown"
              name="contentMarkdown"
              rows={10}
              className="font-mono text-sm"
              placeholder={'# Title\n\nThe full body of the document — supports markdown.'}
            />
            <p className="text-xs text-slate-500">
              Becomes version 1. You can revise it from the detail page; old versions are kept
              immutable.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/documents">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create draft</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
