// One-off: bring every document master onto the house paper size.
//
// The legacy import brought in A4 masters — 382 of 383 documents — while the
// blank master new documents start from is Letter. A book composed from mixed
// paper has to scale the odd sizes down to fit, which shrinks their type and
// widens their margins against everything else, so the whole manual reads as a
// pile of documents rather than one.
//
// Converting the MASTER, not just the render, is the durable fix: the author
// sees Letter in the editor, and the next save cannot reintroduce A4.
//
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/convert-documents-to-letter.ts [--apply]
//
// Without --apply it reports what it would do and changes nothing.
//
// NOTE: this rewrites published version snapshots in place. That is deliberate
// for a pre-launch library of imported content — the documents are being
// corrected, not revised — but it does mean an approved snapshot's bytes change.

import { and, eq, isNotNull } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '@beaconhs/office'
import { readDocxPageSize, setDocxPageSize } from '@beaconhs/office/docx-page-size'
import JSZip from 'jszip'

const TARGET = 'letter'
const MAX_TEXT_CHARS = 1_500_000
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Candidate = {
  versionId: string
  documentId: string
  tenantId: string
  version: number
  docKey: string
  docTitle: string
  docxKey: string
}

async function pageSizeOf(docx: Buffer): Promise<string | null> {
  const entry = (await JSZip.loadAsync(docx)).file('word/document.xml')
  if (!entry) return null
  return readDocxPageSize(await entry.async('string'))
}

async function main() {
  const apply = process.argv.includes('--apply')

  const candidates = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        versionId: documentVersions.id,
        documentId: documentVersions.documentId,
        tenantId: documentVersions.tenantId,
        version: documentVersions.version,
        docKey: documents.key,
        docTitle: documents.title,
        docxKey: attachments.r2Key,
      })
      .from(documentVersions)
      .innerJoin(attachments, eq(attachments.id, documentVersions.docxAttachmentId))
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(isNotNull(documentVersions.docxAttachmentId)),
  )

  console.log(`${candidates.length} version(s) with a Word master`)

  let converted = 0
  let alreadyCorrect = 0
  let failed = 0

  for (const row of candidates as Candidate[]) {
    const label = `${row.docKey || row.docTitle} v${row.version}`
    try {
      const docx = await getObject({ key: row.docxKey })
      const size = await pageSizeOf(docx)
      if (size === TARGET) {
        alreadyCorrect++
        continue
      }

      if (!apply) {
        console.log(`  would convert ${label} (${size ?? 'unknown'} -> ${TARGET})`)
        converted++
        continue
      }

      const letter = await setDocxPageSize(docx, TARGET)
      const pdf = await sofficeConvert(letter, 'document.docx', 'pdf')
      const text = (await sofficeConvert(letter, 'document.docx', 'txt:Text'))
        .toString('utf8')
        .slice(0, MAX_TEXT_CHARS)

      const base =
        (row.docKey || row.docTitle || 'document')
          .replace(/[^\w.\- ]+/g, '')
          .trim()
          .slice(0, 180) || 'document'
      const docxName = `${base}-v${row.version}.docx`
      const pdfName = `${base}-v${row.version}.pdf`
      const docxObjectKey = newAttachmentKey({
        tenantId: row.tenantId,
        kind: 'document',
        filename: docxName,
      })
      const pdfObjectKey = newAttachmentKey({
        tenantId: row.tenantId,
        kind: 'document',
        filename: pdfName,
      })
      await putObject({ key: docxObjectKey, body: letter, contentType: DOCX_MIME })
      await putObject({
        key: pdfObjectKey,
        body: pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })

      await withTenant(db, row.tenantId, async (tx) => {
        const [docxAtt] = await tx
          .insert(attachments)
          .values({
            tenantId: row.tenantId,
            kind: 'document',
            r2Key: docxObjectKey,
            contentType: DOCX_MIME,
            sizeBytes: letter.length,
            filename: docxName,
          })
          .returning()
        const [pdfAtt] = await tx
          .insert(attachments)
          .values({
            tenantId: row.tenantId,
            kind: 'document',
            r2Key: pdfObjectKey,
            contentType: 'application/pdf',
            sizeBytes: pdf.length,
            filename: pdfName,
          })
          .returning()
        if (!docxAtt || !pdfAtt) throw new Error('Failed to store the converted files')
        await tx
          .update(documentVersions)
          .set({
            docxAttachmentId: docxAtt.id,
            pdfAttachmentId: pdfAtt.id,
            textContent: text,
            renderStatus: 'complete',
            renderError: null,
          })
          .where(
            and(
              eq(documentVersions.id, row.versionId),
              eq(documentVersions.tenantId, row.tenantId),
            ),
          )
        await audit(tx, {
          tenantId: row.tenantId,
          entityType: 'document',
          entityId: row.documentId,
          action: 'update',
          summary: `Converted version ${row.version} to ${TARGET} paper`,
          metadata: { versionId: row.versionId, from: size, to: TARGET },
        })
      })

      converted++
      if (converted % 25 === 0) console.log(`  converted ${converted}…`)
    } catch (error) {
      failed++
      console.error(`  FAILED ${label}: ${(error as Error).message}`)
    }
  }

  console.log(
    `\n${apply ? 'converted' : 'would convert'} ${converted}; already ${TARGET}: ${alreadyCorrect}; failed: ${failed}`,
  )
  if (!apply) console.log('Re-run with --apply to write the changes.')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
