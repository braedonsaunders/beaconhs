import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
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
  documentVersions,
  documents,
} from '@beaconhs/db/schema'
import { MAX_DOCUMENT_BOOK_ITEMS } from '@beaconhs/db'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { isUuid } from '@/lib/list-params'
import {
  livePublishedDocumentIds,
  lockDraftDocumentBook,
  publishDocumentBook,
  unpublishDocumentBook,
} from '@/lib/document-book-lifecycle'
import { ReorderableList } from './_components/reorderable-list'

export const dynamic = 'force-dynamic'

const TABS = ['contents', 'settings'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1bae8f249c14b9', { value0: id.slice(0, 8) }) }
}

// ---------- Server actions ----------

async function addDocumentToBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  const documentId = String(formData.get('documentId') ?? '')
  if (!isUuid(bookId) || !isUuid(documentId)) throw new Error('Book or document not found.')

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const publishedIds = await livePublishedDocumentIds(tx, ctx.tenantId, [documentId])
    if (!publishedIds.has(documentId)) {
      throw new Error('Only live published documents can be added to a book.')
    }
    const existing = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.documentId, documentId),
        ),
      )
      .limit(1)
    if (existing.length > 0) return
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${documentBookItems.position}), -1)` })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
    const nextPos = (Number(maxRow?.max ?? -1) ?? -1) + 1
    await tx.insert(documentBookItems).values({
      tenantId: ctx.tenantId,
      bookId,
      documentId,
      position: nextPos,
    })
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
    if (Number(countRow?.count ?? 0) > MAX_DOCUMENT_BOOK_ITEMS) {
      throw new Error(`Document books may contain at most ${MAX_DOCUMENT_BOOK_ITEMS} documents.`)
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Added document to book',
      after: { documentId, position: nextPos },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

async function publishBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  await ctx.db((tx) => publishDocumentBook(tx, ctx, bookId))
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

async function unpublishBook(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  await ctx.db((tx) => unpublishDocumentBook(tx, ctx, bookId))
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
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (!title) throw new Error('Enter a book title.')
  if (categoryId && !isUuid(categoryId)) throw new Error('Select a valid category.')
  if (typeId && !isUuid(typeId)) throw new Error('Select a valid type.')
  if (
    reviewFrequencyMonths !== null &&
    (!Number.isInteger(reviewFrequencyMonths) ||
      reviewFrequencyMonths < 1 ||
      reviewFrequencyMonths > 120)
  ) {
    throw new Error('Review frequency must be a whole number from 1 to 120 months.')
  }
  if (nextReviewOn && !/^\d{4}-\d{2}-\d{2}$/.test(nextReviewOn)) {
    throw new Error('Select a valid next review date.')
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    if (categoryId) {
      const [category] = await tx
        .select({ id: documentCategories.id })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.tenantId, ctx.tenantId),
            eq(documentCategories.id, categoryId),
            isNull(documentCategories.deletedAt),
          ),
        )
        .limit(1)
      if (!category) throw new Error('The selected category is unavailable.')
    }
    if (typeId) {
      const [type] = await tx
        .select({ id: documentTypes.id })
        .from(documentTypes)
        .where(
          and(
            eq(documentTypes.tenantId, ctx.tenantId),
            eq(documentTypes.id, typeId),
            isNull(documentTypes.deletedAt),
          ),
        )
        .limit(1)
      if (!type) throw new Error('The selected type is unavailable.')
    }
    await tx
      .update(documentBooks)
      .set({ title, description, categoryId, typeId, reviewFrequencyMonths, nextReviewOn })
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Updated book settings',
      after: { title, description, categoryId, typeId, reviewFrequencyMonths, nextReviewOn },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

async function renderBookPdf(formData: FormData): Promise<void> {
  'use server'
  const bookId = String(formData.get('bookId') ?? '')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'contents')
  const ctx = await requireRequestContext()
  // The book detail page is a manage-only surface (publish/settings/contents
  // forms). Readers open published books as a PDF from the books library —
  // mirrors the list page, which limits non-managers to published cards.
  if (!can(ctx, 'documents.manage')) notFound()

  const data = await ctx.db(async (tx) => {
    const [book] = await tx
      .select()
      .from(documentBooks)
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, id)))
      .limit(1)
    if (!book) return null
    const items = await tx
      .select({
        item: documentBookItems,
        doc: documents,
        pinnedVersion: documentVersions.version,
      })
      .from(documentBookItems)
      .innerJoin(
        documents,
        and(
          eq(documents.tenantId, documentBookItems.tenantId),
          eq(documents.id, documentBookItems.documentId),
        ),
      )
      .leftJoin(
        documentVersions,
        and(
          eq(documentVersions.tenantId, documentBookItems.tenantId),
          eq(documentVersions.documentId, documentBookItems.documentId),
          eq(documentVersions.id, documentBookItems.documentVersionId),
        ),
      )
      .where(and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, id)))
      .orderBy(asc(documentBookItems.position))
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
    return { book, items, categories, types }
  })

  if (!data) notFound()
  const { book, items, categories, types } = data
  const memberIds = items.map((row) => row.doc.id)
  const basePath = `/documents/books/${id}`
  const display = book.title || '(untitled)'
  const categoryName = categories.find((category) => category.id === book.categoryId)?.name ?? null

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/books', label: 'Back to books' }}
          title={tGeneratedValue(display)}
          subtitle={tGeneratedValue(
            `${categoryName ?? 'Book'} · ${items.length} ${items.length === 1 ? 'document' : 'documents'}`,
          )}
          badge={
            <Badge variant={book.status === 'published' ? 'success' : 'secondary'}>
              <GeneratedValue value={book.status} />
            </Badge>
          }
          actions={
            <>
              <form action={renderBookPdf} className="inline">
                <input type="hidden" name="bookId" value={id} />
                <Button type="submit" variant="outline">
                  <FileDown size={14} /> <GeneratedText id="m_0aff97b409282d" />
                </Button>
              </form>
              <GeneratedValue
                value={
                  book.status === 'published' ? (
                    <form action={unpublishBook} className="inline">
                      <input type="hidden" name="bookId" value={id} />
                      <Button type="submit" variant="outline">
                        <GeneratedText id="m_0d6976fc2d60c8" />
                      </Button>
                    </form>
                  ) : (
                    <form action={publishBook} className="inline">
                      <input type="hidden" name="bookId" value={id} />
                      <Button type="submit">
                        <Check size={14} /> <GeneratedText id="m_1d99c941e4c924" />
                      </Button>
                    </form>
                  )
                }
              />
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
        <GeneratedValue
          value={
            active === 'contents' ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_126ceee83986b6" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <GeneratedValue
                      value={
                        items.length === 0 ? (
                          <EmptyState
                            icon={<FileText size={24} />}
                            title={tGenerated('m_14484cddf006df')}
                            description={tGenerated('m_0a7e8f9533a136')}
                          />
                        ) : (
                          // Keyed by the member set (order-insensitive) so the client
                          // list remounts with fresh server data when the Add form or
                          // a removal changes membership, while in-place drag reorders
                          // keep their optimistic client state.
                          <ReorderableList
                            key={items
                              .map(
                                (row) => `${row.doc.id}:${row.item.documentVersionId ?? 'draft'}`,
                              )
                              .sort()
                              .join('|')}
                            bookId={id}
                            locked={book.status === 'published'}
                            initial={items.map((row) => ({
                              documentId: row.doc.id,
                              title: row.doc.title,
                              status: row.doc.status,
                              pinnedVersion: row.pinnedVersion,
                            }))}
                          />
                        )
                      }
                    />
                  </CardContent>
                </Card>

                <GeneratedValue
                  value={
                    book.status === 'draft' ? (
                      <Section title={tGenerated('m_0455cf9297a120')}>
                        <form action={addDocumentToBook} className="flex items-end gap-2">
                          <input type="hidden" name="bookId" value={id} />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <Label htmlFor="documentId">
                              <GeneratedText id="m_18ce070374179f" />
                            </Label>
                            <RemoteSelectField
                              lookup="document-book-documents"
                              id="documentId"
                              name="documentId"
                              excludedValues={memberIds}
                              placeholder={tGenerated('m_06dbab14b14732')}
                              searchPlaceholder={tGenerated('m_1b287b853289df')}
                              sheetTitle="Add document to book"
                              clearable={false}
                            />
                          </div>
                          <Button type="submit">
                            <GeneratedText id="m_16c8592e5020a4" />
                          </Button>
                        </form>
                      </Section>
                    ) : (
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        <GeneratedText id="m_1c2f5f21df4d47" />
                      </p>
                    )
                  }
                />
              </>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'settings' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_07c584eb0f8e2a" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={updateBookSettings} className="space-y-4 text-sm">
                    <input type="hidden" name="bookId" value={id} />
                    <Field label={tGenerated('m_0decefd558c355')} required>
                      <Input
                        name="title"
                        defaultValue={book.title}
                        required
                        disabled={book.status === 'published'}
                      />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={tGenerated('m_108b41637f364f')}>
                        <Select
                          name="categoryId"
                          defaultValue={book.categoryId ?? ''}
                          disabled={book.status === 'published'}
                        >
                          <option value="">—</option>
                          <GeneratedValue
                            value={categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                <GeneratedValue value={c.name} />
                              </option>
                            ))}
                          />
                        </Select>
                      </Field>
                      <Field label={tGenerated('m_074ba2f160c506')}>
                        <Select
                          name="typeId"
                          defaultValue={book.typeId ?? ''}
                          disabled={book.status === 'published'}
                        >
                          <option value="">—</option>
                          <GeneratedValue
                            value={types.map((t) => (
                              <option key={t.id} value={t.id}>
                                <GeneratedValue value={t.name} />
                              </option>
                            ))}
                          />
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={tGenerated('m_1518910aa83afa')}>
                        <Input
                          name="reviewFrequencyMonths"
                          type="number"
                          min="1"
                          max="120"
                          defaultValue={book.reviewFrequencyMonths ?? ''}
                          placeholder="12"
                          disabled={book.status === 'published'}
                        />
                      </Field>
                      <Field label={tGenerated('m_146d385340eb4f')}>
                        <Input
                          name="nextReviewOn"
                          type="date"
                          defaultValue={book.nextReviewOn ?? ''}
                          disabled={book.status === 'published'}
                        />
                      </Field>
                    </div>
                    <Field label={tGenerated('m_14d923495cf14c')}>
                      <Textarea
                        name="description"
                        rows={3}
                        defaultValue={book.description ?? ''}
                        disabled={book.status === 'published'}
                      />
                    </Field>
                    <GeneratedValue
                      value={
                        book.status === 'draft' ? (
                          <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                            <Button type="submit">
                              <GeneratedText id="m_0bdcc953ae29cd" />
                            </Button>
                          </div>
                        ) : (
                          <p className="border-t border-slate-100 pt-4 text-slate-600 dark:border-slate-800 dark:text-slate-300">
                            <GeneratedText id="m_1daa71dd58f9e7" />{' '}
                            <strong>
                              <GeneratedText id="m_0d6976fc2d60c8" />
                            </strong>{' '}
                            <GeneratedText id="m_1aaedc7c7c22fc" />
                          </p>
                        )
                      }
                    />
                  </form>
                </CardContent>
              </Card>
            ) : null
          }
        />
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
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
