import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, notInArray, ne, sql } from 'drizzle-orm'
import { ArrowDown, ArrowUp, Check, FileDown, FileText, Trash2 } from 'lucide-react'
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
import { documentBookItems, documentBooks, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'

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

async function removeDocumentFromBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const bookId = String(formData.get('bookId') ?? '')
  const documentId = String(formData.get('documentId') ?? '')
  if (!bookId || !documentId) return

  await ctx.db(async (tx) => {
    await tx
      .delete(documentBookItems)
      .where(
        and(eq(documentBookItems.bookId, bookId), eq(documentBookItems.documentId, documentId)),
      )
    // Renumber positions to keep them contiguous.
    const remaining = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(eq(documentBookItems.bookId, bookId))
      .orderBy(asc(documentBookItems.position))
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(eq(documentBookItems.id, remaining[i]!.id))
    }
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Removed document from book',
    before: { documentId },
  })
  revalidatePath(`/documents/books/${bookId}`)
}

async function reorderBookItems(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const bookId = String(formData.get('bookId') ?? '')
  const orderedIdsRaw = String(formData.get('orderedIds') ?? '')
  if (!bookId || !orderedIdsRaw) return
  const orderedIds = orderedIdsRaw.split(',').filter(Boolean)
  if (orderedIds.length === 0) return

  await ctx.db(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(
          and(
            eq(documentBookItems.bookId, bookId),
            eq(documentBookItems.documentId, orderedIds[i]!),
          ),
        )
    }
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Reordered book items',
    after: { orderedIds },
  })
  revalidatePath(`/documents/books/${bookId}`)
}

async function moveItem(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const bookId = String(formData.get('bookId') ?? '')
  const documentId = String(formData.get('documentId') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!bookId || !documentId || (direction !== 'up' && direction !== 'down')) return

  await ctx.db(async (tx) => {
    const items = await tx
      .select()
      .from(documentBookItems)
      .where(eq(documentBookItems.bookId, bookId))
      .orderBy(asc(documentBookItems.position))
    const idx = items.findIndex((i) => i.documentId === documentId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.length) return
    const a = items[idx]!
    const b = items[swapIdx]!
    await tx.update(documentBookItems).set({ position: b.position }).where(eq(documentBookItems.id, a.id))
    await tx.update(documentBookItems).set({ position: a.position }).where(eq(documentBookItems.id, b.id))
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: `Moved document ${direction}`,
    after: { documentId, direction },
  })
  revalidatePath(`/documents/books/${bookId}`)
}

async function publishBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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
  const bookId = String(formData.get('bookId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const status = String(formData.get('status') ?? '') as 'draft' | 'published'
  if (!bookId || !title) return

  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = { title, name: title, description, category }
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
    after: { title, description, category, status },
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
            .where(and(ne(documents.status, 'archived'), notInArray(documents.id, memberIds)))
            .orderBy(asc(documents.title))
            .limit(200)
        : await tx
            .select({ id: documents.id, title: documents.title, status: documents.status })
            .from(documents)
            .where(ne(documents.status, 'archived'))
            .orderBy(asc(documents.title))
            .limit(200)
    return { book, items, available }
  })

  if (!data) notFound()
  const { book, items, available } = data
  const basePath = `/documents/books/${id}`
  const display = book.title || book.name || '(untitled)'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/books', label: 'Back to books' }}
          title={display}
          subtitle={`${book.category ?? 'book'} · ${items.length} ${items.length === 1 ? 'document' : 'documents'}`}
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
                    title="No documents in this book yet"
                    description="Use the picker below to add documents in the order you want them to appear in the PDF."
                  />
                ) : (
                  <ol className="space-y-2 text-sm">
                    {items.map((row, idx) => (
                      <li
                        key={row.item.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-6 shrink-0 font-mono text-xs text-slate-400">
                            {idx + 1}.
                          </span>
                          <Link
                            href={`/documents/${row.doc.id}`}
                            className="truncate font-medium text-slate-900 hover:underline"
                          >
                            {row.doc.title}
                          </Link>
                          {row.doc.status !== 'published' ? (
                            <Badge variant="warning">{row.doc.status}</Badge>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <form action={moveItem} className="inline">
                            <input type="hidden" name="bookId" value={id} />
                            <input type="hidden" name="documentId" value={row.doc.id} />
                            <input type="hidden" name="direction" value="up" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={idx === 0}
                              aria-label="Move up"
                            >
                              <ArrowUp size={14} />
                            </Button>
                          </form>
                          <form action={moveItem} className="inline">
                            <input type="hidden" name="bookId" value={id} />
                            <input type="hidden" name="documentId" value={row.doc.id} />
                            <input type="hidden" name="direction" value="down" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={idx === items.length - 1}
                              aria-label="Move down"
                            >
                              <ArrowDown size={14} />
                            </Button>
                          </form>
                          <form action={removeDocumentFromBook} className="inline">
                            <input type="hidden" name="bookId" value={id} />
                            <input type="hidden" name="documentId" value={row.doc.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label="Remove from book"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </Button>
                          </form>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Section title="Add a document to this book">
              {available.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No more documents available — every published document is already in this book.
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
                  <Input name="title" defaultValue={book.title || book.name || ''} required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Category">
                    <Input name="category" defaultValue={book.category ?? ''} />
                  </Field>
                  <Field label="Status">
                    <Select name="status" defaultValue={book.status}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Description">
                  <Textarea name="description" rows={3} defaultValue={book.description ?? ''} />
                </Field>
                <div className="flex justify-end border-t border-slate-100 pt-4">
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
