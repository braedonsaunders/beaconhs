// Pin the document versions on books that were imported as `published` without
// ever going through the app's publish path.
//
// Publishing a book is what pins every item to the exact immutable version
// readers get (`document_book_items.document_version_id`). The legacy import
// created books already in `published` status — note `published_by_user_id` is
// null and `published_at` carries legacy dates — so it wrote the status without
// the pins. Rendering a published book uses `published-render` mode, which
// refuses to guess a version, so every book failed with:
//
//   Published book item <key> has no pinned document version.
//
// This resolves each item exactly the way `publishDocumentBook` does, by
// reusing `resolveDocumentBookItems` in `publish` mode rather than restating
// the selection rules — if publishing changes, this follows automatically.
//
// Idempotent: items that already carry a pin are left untouched, so this only
// repairs the gaps and is safe to re-run after the pre-cutover data reload.
//
// Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/scripts/backfill-document-book-pins.ts [--apply]
//
// Without --apply it reports what it would pin and writes nothing.

import { createSuperClient } from '../client'
import {
  resolveDocumentBookItems,
  type DocumentBookSnapshotAttachment,
  type DocumentBookSnapshotItem,
  type DocumentBookSnapshotVersion,
} from '../document-book-publication'

type BookRow = { id: string; tenantId: string; title: string; tenantSlug: string }

async function main() {
  const apply = process.argv.includes('--apply')
  const { sql } = createSuperClient({ max: 1 })

  try {
    const books = (await sql`
      select b.id, b.tenant_id as "tenantId", b.title, t.slug as "tenantSlug"
        from document_books b
        join tenants t on t.id = b.tenant_id
       where b.status = 'published'
         and exists (
           select 1 from document_book_items i
            where i.book_id = b.id
              and i.tenant_id = b.tenant_id
              and i.document_version_id is null
         )
       order by t.slug, b.title
    `) as unknown as BookRow[]

    if (books.length === 0) {
      console.log('No published books have unpinned items.')
      return
    }

    let pinned = 0
    let failed = 0

    for (const book of books) {
      const items = (await sql`
        select i.id as "itemId", i.document_id as "documentId", d.title as "documentTitle",
               d.key as "documentKey", d.status as "documentStatus",
               d.deleted_at as "documentDeletedAt", i.document_version_id as "pinnedVersionId"
          from document_book_items i
          join documents d on d.id = i.document_id and d.tenant_id = i.tenant_id
         where i.tenant_id = ${book.tenantId} and i.book_id = ${book.id}
         order by i.position asc, i.id asc
      `) as unknown as DocumentBookSnapshotItem[]

      const versions = (await sql`
        select distinct on (v.document_id)
               v.id, v.document_id as "documentId", v.version,
               v.pdf_attachment_id as "pdfAttachmentId",
               v.content_attachment_id as "contentAttachmentId"
          from document_versions v
         where v.tenant_id = ${book.tenantId}
           and v.document_id in ${sql(items.map((i) => i.documentId))}
           and v.published_at is not null
         order by v.document_id, v.version desc
      `) as unknown as DocumentBookSnapshotVersion[]

      const attachmentIds = [
        ...new Set(
          versions
            .map((v) => v.pdfAttachmentId ?? v.contentAttachmentId)
            .filter((id): id is string => id !== null),
        ),
      ]
      const attachments =
        attachmentIds.length === 0
          ? []
          : ((await sql`
              select a.id, a.kind, a.content_type as "contentType",
                     a.size_bytes as "sizeBytes", a.r2_key as "key"
                from attachments a
               where a.tenant_id = ${book.tenantId} and a.id in ${sql(attachmentIds)}
            `) as unknown as DocumentBookSnapshotAttachment[])

      let pins
      try {
        // `publish` mode picks the latest published version per document —
        // identical to what publishing the book would have pinned.
        pins = resolveDocumentBookItems({ mode: 'publish', items, versions, attachments })
      } catch (error) {
        failed++
        console.log(`  SKIP  ${book.tenantSlug}/${book.title}: ${(error as Error).message}`)
        continue
      }

      const missing = pins.filter((pin) => {
        const item = items.find((i) => i.itemId === pin.itemId)
        return item && item.pinnedVersionId === null
      })
      console.log(
        `  ${book.tenantSlug}/${book.title}: ${missing.length} of ${items.length} item(s) to pin`,
      )

      if (!apply) continue

      for (const pin of missing) {
        const result = await sql`
          update document_book_items
             set document_version_id = ${pin.versionId}, updated_at = now()
           where tenant_id = ${book.tenantId}
             and book_id = ${book.id}
             and id = ${pin.itemId}
             and document_id = ${pin.documentId}
             and document_version_id is null
        `
        pinned += result.count ?? 0
      }
    }

    console.log(
      apply
        ? `\npinned ${pinned} item(s); ${failed} book(s) skipped.`
        : `\nDRY RUN — pass --apply to write. ${failed} book(s) would be skipped.`,
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
