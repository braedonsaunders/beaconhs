import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { documentBooks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New document book' }

const CATEGORIES = [
  { value: 'management_review', label: 'Management review pack' },
  { value: 'orientation', label: 'New-hire orientation' },
  { value: 'safety_program', label: 'Safety program manual' },
  { value: 'site_pack', label: 'Site safety pack' },
  { value: 'other', label: 'Other' },
]

async function createBook(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  if (!title) return

  const bookId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentBooks)
      .values({
        tenantId: ctx.tenantId,
        title,
        name: title, // keep legacy column populated
        description,
        category,
        status: 'draft',
      })
      .returning({ id: documentBooks.id })
    if (!row) throw new Error('Failed to insert book')
    return row.id
  })

  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'create',
    summary: `Created document book "${title}"`,
    after: { title, category, description },
  })
  revalidatePath('/documents/books')
  redirect(`/documents/books/${bookId}`)
}

export default function NewBookPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New document book"
          description="A book is an ordered bundle of documents. Once you've added the documents you want, publish the book to lock the order + produce a single combined PDF."
          back={{ href: '/documents/books', label: 'Back to books' }}
        />
        <form
          action={createBook}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="e.g. 2026 Q1 Management Review Pack"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select id="category" name="category" defaultValue="management_review">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Short description</Label>
            <Textarea id="description" name="description" rows={3} />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/documents/books">
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
