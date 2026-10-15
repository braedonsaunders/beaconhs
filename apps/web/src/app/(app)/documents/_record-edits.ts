// The `documents` record saver: the document's header metadata (Overview tab),
// queued on the device by the document page and applied by /api/records/sync
// (see lib/record-sync). Same rules the metadata form has always had — the
// `documents.manage` permission, live (not deleted) documents only, the
// metadata limits, a slugged key that no other live document uses, existing
// categories/types, and PDF headers only on documents with a Word working
// file — applied per field as a compare-and-set against the value the device
// last saw. The metadata fields are independent (no rule spans two of them),
// so each one is its own op and a concurrent edit to one field never blocks
// another.

import { and, eq, isNull } from 'drizzle-orm'
import { documentCategories, documentTypes, documents } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { recordAuditInTransaction } from '@/lib/audit'
import { isDocumentKeyConflict, parseDocumentKey } from '@/lib/document-key-policy'
import { DOCUMENT_METADATA_LIMITS } from '@/lib/document-metadata-limits'
import {
  optionalDate,
  optionalInteger,
  optionalRef,
  optionalText,
  requiredText,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  defineRecordSaver,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
} from '@/lib/record-sync/edits'

type DocumentRow = typeof documents.$inferSelect

/** The metadata the Overview tab edits — each one is an op key. */
const DOCUMENT_METADATA_FIELDS = [
  'title',
  'key',
  'categoryId',
  'typeId',
  'description',
  'reviewFrequencyMonths',
  'nextReviewOn',
  'showDocumentHeader',
  'headerIssuedOn',
  'headerRevisedOn',
  'headerApprovedBy',
  'headerVersionLabel',
] as const
type DocumentMetadataField = (typeof DOCUMENT_METADATA_FIELDS)[number]

function isMetadataField(op: string): op is DocumentMetadataField {
  return (DOCUMENT_METADATA_FIELDS as readonly string[]).includes(op)
}

const documentKey: Codec<string> = {
  parse: (wire) => {
    const parsed = parseDocumentKey(wire)
    if (!parsed.ok) throw new RecordEditRejection(parsed.error)
    return parsed.key
  },
  format: (value) => value,
}

/** The PDF-header switch ('true' / 'false' on the wire). */
function headerSwitch(row: DocumentRow): Codec<boolean> {
  return {
    parse: (wire) => {
      if (wire !== 'true' && wire !== 'false') {
        throw new RecordEditRejection('The document header setting is invalid.')
      }
      const value = wire === 'true'
      if (value && !row.sourceAttachmentId) {
        throw new RecordEditRejection('PDF headers require a Word working document.')
      }
      return value
    },
    format: (value) => (value ? 'true' : 'false'),
  }
}

type Codecs = { [K in DocumentMetadataField]: Codec<DocumentRow[K]> }

function metadataCodecs(row: DocumentRow): Codecs {
  return {
    title: requiredText({ label: 'Title', maxLength: DOCUMENT_METADATA_LIMITS.title }),
    key: documentKey,
    categoryId: optionalRef({ label: 'Category' }),
    typeId: optionalRef({ label: 'Type' }),
    description: optionalText({
      label: 'Description',
      maxLength: DOCUMENT_METADATA_LIMITS.description,
    }),
    reviewFrequencyMonths: optionalInteger({
      label: 'Review frequency',
      min: 1,
      max: DOCUMENT_METADATA_LIMITS.reviewFrequencyMonths,
    }),
    nextReviewOn: optionalDate({ label: 'Next review date' }),
    showDocumentHeader: headerSwitch(row),
    headerIssuedOn: optionalDate({ label: 'Issue date' }),
    headerRevisedOn: optionalDate({ label: 'Revision date' }),
    headerApprovedBy: optionalText({
      label: 'Approved by',
      maxLength: DOCUMENT_METADATA_LIMITS.headerApprovedBy,
    }),
    headerVersionLabel: optionalText({
      label: 'Printed version',
      maxLength: DOCUMENT_METADATA_LIMITS.headerVersionLabel,
    }),
  }
}

async function assertLiveCategory(tx: Database, id: string | null): Promise<void> {
  if (!id) return
  const [category] = await tx
    .select({ id: documentCategories.id })
    .from(documentCategories)
    .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
    .limit(1)
  if (!category) throw new RecordEditRejection('The selected category no longer exists.')
}

async function assertLiveType(tx: Database, id: string | null): Promise<void> {
  if (!id) return
  const [type] = await tx
    .select({ id: documentTypes.id })
    .from(documentTypes)
    .where(and(eq(documentTypes.id, id), isNull(documentTypes.deletedAt)))
    .limit(1)
  if (!type) throw new RecordEditRejection('The selected type no longer exists.')
}

function metadataOp<K extends DocumentMetadataField>(
  tx: Database,
  ctx: RequestContext,
  row: DocumentRow,
  field: K,
): ErasedRecordOp {
  const codec = metadataCodecs(row)[field]
  return recordOp<DocumentRow[K]>({
    current: row[field],
    parse: codec.parse,
    format: codec.format,
    write: async (value) => {
      if (field === 'categoryId') await assertLiveCategory(tx, value as string | null)
      if (field === 'typeId') await assertLiveType(tx, value as string | null)
      try {
        await tx
          .update(documents)
          .set({ ...({ [field]: value } as Partial<DocumentRow>), updatedAt: new Date() })
          .where(
            and(
              eq(documents.id, row.id),
              eq(documents.tenantId, ctx.tenantId),
              isNull(documents.deletedAt),
            ),
          )
      } catch (error) {
        if (field === 'key' && isDocumentKeyConflict(error)) {
          throw new RecordEditRejection('A live document already uses that key.')
        }
        throw error
      }
      row[field] = value
    },
  })
}

export const documentRecordSaver = defineRecordSaver<DocumentRow>('documents', {
  authorize: (ctx) => ctx.isSuperAdmin || can(ctx, 'documents.manage'),
  async load(tx, ctx, documentId) {
    const [row] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.tenantId, ctx.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    return row
  },
  resolve: (tx, ctx, row, op) => (isMetadataField(op) ? metadataOp(tx, ctx, row, op) : null),
  // One "Updated document details" entry per batch, with the changed fields.
  afterWrites: (tx, ctx, row, changes) =>
    recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: row.id,
      action: 'update',
      summary: 'Updated document details',
      before: Object.fromEntries(changes.map((change) => [change.op, change.before])),
      after: Object.fromEntries(changes.map((change) => [change.op, change.after])),
    }),
  revalidate: (documentId) => [`/documents/${documentId}`, '/documents'],
})
