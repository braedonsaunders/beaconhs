import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Paintbrush } from 'lucide-react'
import { Badge, Button, DetailHeader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import {
  documentBookItems,
  documentBooks,
  documentCategories,
  documentTypes,
  documentVersions,
  documents,
  pdfTemplates,
} from '@beaconhs/db/schema'
import { resolveBookPrintSettings } from '@beaconhs/db'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { isUuid } from '@/lib/list-params'
import { BookBuilder } from './_components/book-builder'
import type { BookEntry } from './_components/book-tree'
import {
  updateBookCoverTemplateAction,
  updateBookPrintSettingsAction,
  updateBookSettingsAction,
} from './actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1bae8f249c14b9', { value0: id.slice(0, 8) }) }
}

export default async function DocumentBookPage({ params }: { params: Promise<{ id: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  // The book builder is a manage-only surface. Readers open published books as
  // a PDF from the books library — mirrors the list page, which limits
  // non-managers to published cards.
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
      // LEFT, not inner: a heading has no document and must still appear in the
      // builder, in its place in the order.
      .leftJoin(
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
    // Cover designs available to this book. Scoped to the document-book subject
    // so the picker cannot offer an incident report as a book cover.
    const covers = await tx
      .select({ id: pdfTemplates.id, name: pdfTemplates.name })
      .from(pdfTemplates)
      .where(
        and(
          eq(pdfTemplates.recordSubjectType, 'module'),
          eq(pdfTemplates.recordSubjectKey, 'document-books'),
          eq(pdfTemplates.isActive, true),
          isNull(pdfTemplates.deletedAt),
        ),
      )
      .orderBy(asc(pdfTemplates.name))
    return { book, items, categories, types, covers }
  })

  if (!data) notFound()
  const { book, items, categories, types, covers } = data
  const activity = await recentActivityForEntity(ctx, 'document_book', id, 50)

  const entries: BookEntry[] = items.map((row) => ({
    itemId: row.item.id,
    kind: row.item.kind,
    documentId: row.doc?.id ?? null,
    // A heading carries its own title; a document entry takes the document's.
    title: row.item.title ?? row.doc?.title ?? '',
    status: row.doc?.status ?? null,
    pinnedVersion: row.pinnedVersion,
  }))
  const documentCount = entries.filter((entry) => entry.kind === 'document').length
  const categoryName = categories.find((category) => category.id === book.categoryId)?.name ?? null
  const locked = book.status === 'published'
  const print = resolveBookPrintSettings(book.printSettings)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/books', label: 'Back to books' }}
          title={tGeneratedValue(book.title || '(untitled)')}
          subtitle={tGeneratedValue(
            `${categoryName ?? 'Book'} · ${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`,
          )}
          badge={
            <Badge variant={locked ? 'success' : 'secondary'}>
              <GeneratedValue value={book.status} />
            </Badge>
          }
        />
      }
      fullBleed
    >
      <BookBuilder
        bookId={id}
        title={tGeneratedValue(book.title || '(untitled)')}
        subtitle={tGenerated('m_1118d1c0b18bf5', {
          value0: entries.filter((entry) => entry.kind === 'chapter').length,
          value1: entries.filter((entry) => entry.kind === 'section').length,
          value2: documentCount,
        })}
        published={locked}
        entries={entries}
        coverSlot={
          <form action={updateBookCoverTemplateAction} className="space-y-4 text-sm">
            <input type="hidden" name="bookId" value={id} />
            <RailSection title={tGenerated('m_147533ff9fba67')}>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0f0fc7237f19f6" />
              </p>
              <GeneratedValue
                value={
                  covers.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <GeneratedText id="m_179750dda904ed" />
                    </p>
                  ) : (
                    <Field label={tGenerated('m_147533ff9fba67')}>
                      <Select
                        name="coverTemplateId"
                        defaultValue={book.coverTemplateId ?? ''}
                        disabled={locked}
                      >
                        <option value="">{tGenerated('m_1f5fff4b7b151c')}</option>
                        {covers.map((cover) => (
                          <option key={cover.id} value={cover.id}>
                            {cover.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )
                }
              />
              <GeneratedValue
                value={
                  locked ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1c2f5f21df4d47" />
                    </p>
                  ) : covers.length > 0 ? (
                    <Button type="submit" className="w-full">
                      <GeneratedText id="m_00ca531f511647" />
                    </Button>
                  ) : null
                }
              />
            </RailSection>

            <RailSection title={tGenerated('m_0e247f6fed1a24')}>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_1b50c4a30cadaf" />
              </p>
              <Link
                href="/admin/pdf-templates"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
              >
                <Paintbrush size={13} aria-hidden />
                <GeneratedText id="m_1fc6b8d86d1ead" />
              </Link>
            </RailSection>
          </form>
        }
        printSlot={
          <form action={updateBookPrintSettingsAction} className="space-y-4 text-sm">
            <input type="hidden" name="bookId" value={id} />
            <RailSection title={tGenerated('m_0ccb1fd4550a71')}>
              <Field label={tGenerated('m_185f497c899c62')}>
                <Select name="paperSize" defaultValue={print.paperSize} disabled={locked}>
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                  <option value="legal">Legal</option>
                </Select>
              </Field>
              <Field label={tGenerated('m_0af3bf11ca2a12')}>
                <Select name="orientation" defaultValue={print.orientation} disabled={locked}>
                  <option value="portrait">{tGenerated('m_062e481bc6e988')}</option>
                  <option value="landscape">{tGenerated('m_0e9e90da7290dd')}</option>
                </Select>
              </Field>
              <Field label={tGenerated('m_0512aeb80e6f21')} hint={tGenerated('m_1bf4a336b8ff31')}>
                <Input
                  name="contentMarginMm"
                  type="number"
                  min="0"
                  max="25"
                  step="0.5"
                  defaultValue={print.contentMarginMm}
                  disabled={locked}
                />
              </Field>
            </RailSection>

            <RailSection title={tGenerated('m_196fa3ffbb4b43')}>
              <PrintToggle
                name="normalizeContent"
                checked={print.normalizeContent}
                disabled={locked}
                label={tGenerated('m_101d6f9449fd93')}
                hint={tGenerated('m_0df0a48c84c006')}
              />
              <PrintToggle
                name="coverPage"
                checked={print.coverPage}
                disabled={locked}
                label={tGenerated('m_1f1b3d6076fd4c')}
                hint={tGenerated('m_1b50c4a30cadaf')}
              />
              <PrintToggle
                name="tableOfContents"
                checked={print.tableOfContents}
                disabled={locked}
                label={tGenerated('m_09726a74acfcf9')}
                hint={tGenerated('m_0369bf66783637')}
              />
              <PrintToggle
                name="documentHeaders"
                checked={print.documentHeaders}
                disabled={locked}
                label={tGenerated('m_11ed0a134c36ba')}
                hint={tGenerated('m_037807e0d5a629')}
              />
              <PrintToggle
                name="documentHeadersOnOwnPage"
                checked={print.documentHeadersOnOwnPage}
                disabled={locked}
                label={tGenerated('m_1841a705af68d0')}
                hint={tGenerated('m_0972c0190a99cc')}
              />
              <PrintToggle
                name="documentPageBreaks"
                checked={print.documentPageBreaks}
                disabled={locked}
                label={tGenerated('m_03eac127a55e29')}
                hint={tGenerated('m_1d26a7b6fd0327')}
              />
              <PrintToggle
                name="footer"
                checked={print.footer}
                disabled={locked}
                label={tGenerated('m_1ae476691a476f')}
                hint={tGenerated('m_01a169ed07c3ce')}
              />
            </RailSection>

            <GeneratedValue
              value={
                locked ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_1c2f5f21df4d47" />
                  </p>
                ) : (
                  <Button type="submit" className="w-full">
                    <GeneratedText id="m_0bdcc953ae29cd" />
                  </Button>
                )
              }
            />
          </form>
        }
        settingsSlot={
          <form action={updateBookSettingsAction} className="space-y-4 text-sm">
            <input type="hidden" name="bookId" value={id} />
            <Field label={tGenerated('m_0decefd558c355')} required>
              <Input name="title" defaultValue={book.title} required disabled={locked} />
            </Field>
            <Field label={tGenerated('m_108b41637f364f')}>
              <Select name="categoryId" defaultValue={book.categoryId ?? ''} disabled={locked}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tGenerated('m_074ba2f160c506')}>
              <Select name="typeId" defaultValue={book.typeId ?? ''} disabled={locked}>
                <option value="">—</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tGenerated('m_1518910aa83afa')}>
                <Input
                  name="reviewFrequencyMonths"
                  type="number"
                  min="1"
                  max="120"
                  defaultValue={book.reviewFrequencyMonths ?? ''}
                  placeholder="12"
                  disabled={locked}
                />
              </Field>
              <Field label={tGenerated('m_146d385340eb4f')}>
                <Input
                  name="nextReviewOn"
                  type="date"
                  defaultValue={book.nextReviewOn ?? ''}
                  disabled={locked}
                />
              </Field>
            </div>
            <Field label={tGenerated('m_14d923495cf14c')}>
              <Textarea
                name="description"
                rows={3}
                defaultValue={book.description ?? ''}
                disabled={locked}
              />
            </Field>
            <GeneratedValue
              value={
                locked ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_1c2f5f21df4d47" />
                  </p>
                ) : (
                  <Button type="submit" className="w-full">
                    <GeneratedText id="m_0bdcc953ae29cd" />
                  </Button>
                )
              }
            />
          </form>
        }
        activitySlot={
          <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
        }
      />
    </DetailPageLayout>
  )
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedValue value={title} />
      </p>
      <GeneratedValue value={children} />
    </div>
  )
}

/**
 * A print switch plus the one line that says what it does to the PDF. Nobody
 * should have to render a 500-page manual to find out what a checkbox means.
 */
function PrintToggle({
  name,
  checked,
  disabled,
  label,
  hint,
}: {
  name: string
  checked: boolean
  disabled: boolean
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-50 dark:border-slate-700"
      />
      <span className="min-w-0">
        <span className="block text-sm text-slate-800 dark:text-slate-100">
          <GeneratedValue value={label} />
        </span>
        <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          <GeneratedValue value={hint} />
        </span>
      </span>
    </label>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
      <GeneratedValue
        value={
          hint ? (
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              <GeneratedValue value={hint} />
            </p>
          ) : null
        }
      />
    </div>
  )
}
