import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull, notInArray, ne, sql } from 'drizzle-orm'
import { Check, FileDown, FileText } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  documentBookItems,
  documentBooks,
  documentCategories,
  documentTypes,
  documents,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { ReorderableList } from './_components/reorderable-list'

export const dynamic = 'force-dynamic'

const TABS = ['contents', 'settings'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Document book · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function addDocumentToBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  const documentId = String(formData.get('documentId') ?? '')
  if (!bookId || !documentId) return

  await ctx.db(async (tx) => {
    const existing = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.bookId, bookId), eq(documentBookItems.documentId, documentId)),
      )
      .limit(1)
    if (existing.length > 0) return
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${documentBookItems.position}), -1)` })
      .from(documentBookItems)
      .where(eq(documentBookItems.bookId, bookId))
    const nextPos = (Number(maxRow?.max ?? -1) ?? -1) + 1
    await tx.insert(documentBookItems).values({
      tenantId: ctx.tenantId,
      bookId,
      documentId,
      position: nextPos,
    })
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Added document to book',
    after: { documentId },
  })
  revalidatePath(`/documents/books/${bookId}`)
}

async function publishBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  if (!bookId) return
  await ctx.db((tx) =>
    tx
      .update(documentBooks)
      .set({ status: 'published', publishedAt: new Date(), publishedByUserId: ctx.userId })
      .where(eq(documentBooks.id, bookId)),
  )
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'publish',
    summary: 'Published document book',
  })
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

async function unpublishBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  if (!bookId) return
  await ctx.db((tx) =>
    tx
      .update(documentBooks)
      .set({ status: 'draft', publishedAt: null, publishedByUserId: null })
      .where(eq(documentBooks.id, bookId)),
  )
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Unpublished document book (set to draft)',
  })
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

async function updateBookSettings(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const categoryId = String(formData.get('categoryId') ?? '').trim() || null
  const typeId = String(formData.get('typeId') ?? '').trim() || null
  const reviewRaw = String(formData.get('reviewFrequencyMonths') ?? '').trim()
  const reviewFrequencyMonths = reviewRaw ? Number(reviewRaw) : null
  const nextReviewOn = String(formData.get('nextReviewOn') ?? '').trim() || null
  const status = String(formData.get('status') ?? '') as 'draft' | 'published'
  if (!bookId || !title) return

  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = {
      title,
      description,
      categoryId,
      typeId,
      reviewFrequencyMonths,
      nextReviewOn,
    }
    if (status === 'published') {
      patch.status = 'published'
      patch.publishedAt = new Date()
      patch.publishedByUserId = ctx.userId
    } else {
      patch.status = 'draft'
      patch.publishedAt = null
      patch.publishedByUserId = null
    }
    await tx.update(documentBooks).set(patch).where(eq(documentBooks.id, bookId))
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Updated book settings',
    after: { title, description, categoryId, typeId, status },
  })
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

async function renderBookPdf(formData: FormData): Promise<void> {
  'use server'
  const bookId = String(formData.get('bookId') ?? '')
  if (!bookId) return
  redirect(`/documents/books/${bookId}/pdf`)
}

// ---------- Page ----------

export default async function DocumentBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'contents')
  const ctx = await requireRequestContext()
  // The book detail page is a manage-only surface (publish/settings/contents
  // forms). Readers open published books as a PDF from the books library —
  // mirrors the list page, which limits non-managers to published cards.
  if (!can(ctx, 'documents.manage')) notFound()

  const data = await ctx.db(async (tx) => {
    const [book] = await tx.select().from(documentBooks).where(eq(documentBooks.id, id)).limit(1)
    if (!book) return null
    const items = await tx
      .select({ item: documentBookItems, doc: documents })
      .from(documentBookItems)
      .innerJoin(documents, eq(documents.id, documentBookItems.documentId))
      .where(eq(documentBookItems.bookId, id))
      .orderBy(asc(documentBookItems.position))
    const memberIds = items.map((r) => r.doc.id)
    const available =
      memberIds.length > 0
        ? await tx
            .select({ id: documents.id, title: documents.title, status: documents.status })
            .from(documents)
            .where(
              and(
                isNull(documents.deletedAt),
                ne(documents.status, 'archived'),
                notInArray(documents.id, memberIds),
              ),
            )
            .orderBy(asc(documents.title))
            .limit(200)
        : await tx
            .select({ id: documents.id, title: documents.title, status: documents.status })
            .from(documents)
            .where(and(isNull(documents.deletedAt), ne(documents.status, 'archived')))
            .orderBy(asc(documents.title))
            .limit(200)
    const categories = await tx
      .select({ id: documentCategories.id, name: documentCategories.name })
      .from(documentCategories)
      .where(isNull(documentCategories.deletedAt))
      .orderBy(asc(documentCategories.name))
    const types = await tx
      .select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes)
      .where(isNull(documentTypes.deletedAt))
      .orderBy(asc(documentTypes.name))
    return { book, items, available, categories, types }
  })

  if (!data) notFound()
  const { book, items, available, categories, types } = data
  const basePath = `/documents/books/${id}`
  const display = book.title || '(untitled)'
  const categoryName = categories.find((category) => category.id === book.categoryId)?.name ?? null

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/books', label: 'Back to books' }}
          title={display}
          subtitle={`${categoryName ?? 'Book'} · ${items.length} ${items.length === 1 ? 'document' : 'documents'}`}
          badge={
            <Badge variant={book.status === 'published' ? 'success' : 'secondary'}>
              {book.status}
            </Badge>
          }
          actions={
            <>
              <form action={renderBookPdf} className="inline">
                <input type="hidden" name="bookId" value={id} />
                <Button type="submit" variant="outline">
                  <FileDown size={14} /> Render PDF
                </Button>
              </form>
              {book.status === 'published' ? (
                <form action={unpublishBook} className="inline">
                  <input type="hidden" name="bookId" value={id} />
                  <Button type="submit" variant="outline">
                    Unpublish
                  </Button>
                </form>
              ) : (
                <form action={publishBook} className="inline">
                  <input type="hidden" name="bookId" value={id} />
                  <Button type="submit">
                    <Check size={14} /> Publish book
                  </Button>
                </form>
              )}
            </>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'contents', label: 'Contents', count: items.length },
            { key: 'settings', label: 'Settings' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'contents' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Order of contents</CardTitle>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No documents in this book"
                    description="Add documents below in the order they should appear in the PDF."
                  />
                ) : (
                  // Keyed by the member set (order-insensitive) so the client
                  // list remounts with fresh server data when the Add form or
                  // a removal changes membership, while in-place drag reorders
                  // keep their optimistic client state.
                  <ReorderableList
                    key={items
                      .map((row) => row.doc.id)
                      .sort()
                      .join('|')}
                    bookId={id}
                    initial={items.map((row) => ({
                      documentId: row.doc.id,
                      title: row.doc.title,
                      status: row.doc.status,
                    }))}
                  />
                )}
              </CardContent>
            </Card>

            <Section title="Add a document to this book">
              {available.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Every available document is already in this book.
                </p>
              ) : (
                <form action={addDocumentToBook} className="flex items-end gap-2">
                  <input type="hidden" name="bookId" value={id} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label htmlFor="documentId">Document</Label>
                    <Select id="documentId" name="documentId" defaultValue="" required>
                      <option value="" disabled>
                        Pick a document…
                      </option>
                      {available.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title} {d.status !== 'published' ? `(${d.status})` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit">Add</Button>
                </form>
              )}
            </Section>
          </>
        ) : null}

        {active === 'settings' ? (
          <Card>
            <CardHeader>
              <CardTitle>Book settings</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateBookSettings} className="space-y-4 text-sm">
                <input type="hidden" name="bookId" value={id} />
                <Field label="Title" required>
                  <Input name="title" defaultValue={book.title} required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Category">
                    <Select name="categoryId" defaultValue={book.categoryId ?? ''}>
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Type">
                    <Select name="typeId" defaultValue={book.typeId ?? ''}>
                      <option value="">—</option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Status">
                    <Select name="status" defaultValue={book.status}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </Select>
                  </Field>
                  <Field label="Review every (mo.)">
                    <Input
                      name="reviewFrequencyMonths"
                      type="number"
                      min="1"
                      defaultValue={book.reviewFrequencyMonths ?? ''}
                      placeholder="12"
                    />
                  </Field>
                  <Field label="Next review">
                    <Input name="nextReviewOn" type="date" defaultValue={book.nextReviewOn ?? ''} />
                  </Field>
                </div>
                <Field label="Description">
                  <Textarea name="description" rows={3} defaultValue={book.description ?? ''} />
                </Field>
                <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                  <Button type="submit">Save settings</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
