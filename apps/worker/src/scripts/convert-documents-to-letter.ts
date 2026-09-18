// One-off: bring every document version up to the house render standard.
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
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/convert-documents-to-letter.ts [--apply] [--limit N]
//
// Without --apply it reports what it would do and changes nothing. It is
// idempotent — anything already on the target size is skipped — so it is meant
// to be run repeatedly in batches until it reports nothing left.
//
// BOUNDED ON PURPOSE. Each document costs two LibreOffice invocations, and a
// few hundred back to back will exhaust a workstation's memory. --limit caps
// how many are converted per run (default 40); raise it only on a machine with
// room to spare.
//
// It also re-renders any version whose stored PDF predates the controlled-header
// reserve: a book stamps its control block across the top of each document's
// first page, and the render now leaves that strip clear so the block lands in
// blank space instead of forcing the page to be scaled down around it.
//
// NOTE: this rewrites published version snapshots in place. That is deliberate
// for a pre-launch library of imported content — the documents are being
// corrected, not revised — but it does mean an approved snapshot's bytes change.

import { and, eq, isNotNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '@beaconhs/office'
import {
  CONTROLLED_HEADER_BAND_PT,
  isNormalizedDocx,
  normalizeDocxTypography,
} from '@beaconhs/office/docx-page-size'
import { renderDocxToPdf } from '../workers/document-render'
import { measureRenderedType } from '../lib/pdf-body-type'

const TARGET = 'letter'
/**
 * The body size every document should LOOK like, as a measured glyph height in
 * points — not a declared point size, which settles nothing when one master is
 * Liberation Serif and the next is a sans face.
 *
 * Reached approximately, not exactly: rendered glyph heights quantise, so a
 * document lands on 12 or 13 and stays there. Whether it is done is decided by
 * `isNormalizedDocx`, which looks at structure — an earlier version of this
 * script asked "does it render at the target yet?" and rewrote the same 83
 * masters 291 times, oscillating 13 -> 12 -> 13 -> 12.
 */
const TARGET_BODY_PT = 12.5
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
  pdfKey: string | null
}

/** The PDF side of a version, joined separately from its DOCX master. */
const renderedPdf = alias(attachments, 'rendered_pdf')

/** Render a master and report the body size it actually produces. */
async function measureRender(docx: Buffer): Promise<{ bodyPt: number | null }> {
  const pdf = await sofficeConvert(docx, 'document.docx', 'pdf')
  return { bodyPt: (await measureRenderedType(pdf)).bodyTypePt }
}

/**
 * Whether a stored render already keeps the controlled-header strip clear.
 *
 * A first page with no text at all cannot answer the question, so it is
 * re-rendered — a handful of blank or image-only masters is cheaper than
 * leaving the block printed over their content.
 *
 * The tolerance is the ascent a word box carries above the line it sits on:
 * a reserved render measures 129.3–130 against a 132pt strip, and a 2pt
 * tolerance read 262 finished documents as unfinished.
 */
const BAND_TOLERANCE_PT = 4

function reservesBand(topPt: number | null): boolean {
  return topPt !== null && topPt >= CONTROLLED_HEADER_BAND_PT - BAND_TOLERANCE_PT
}

/** Where a document's body text should start, in points from the sheet edge. */
const TARGET_BODY_LEFT_PT = 36
/**
 * How far past that a document may start before it is treated as indented.
 *
 * A first-level indent of a fifth of an inch is typography; the masters this
 * catches indent their whole body about 1.2 inches, which leaves their text
 * column at 66% of the sheet against 83% for the rest of the library. The
 * threshold keeps the correction off documents that only carry the former.
 */
const MIN_INDENT_EXCESS_PT = 24

/** How far a rendered document's indents need pulling in, in twips. */
function indentReduceTwips(bodyLeftPt: number | null): number {
  if (bodyLeftPt === null) return 0
  const excess = bodyLeftPt - TARGET_BODY_LEFT_PT
  return excess > MIN_INDENT_EXCESS_PT ? Math.round(excess * 20) : 0
}

/** Conversions per run, unless --limit says otherwise. */
const DEFAULT_LIMIT = 40

/**
 * Split the work so several copies of this script can run at once.
 *
 * Each conversion is two LibreOffice renders, and LibreOffice is single
 * threaded — one process leaves most of a workstation idle. `--shard 2/6`
 * takes every sixth version starting at the second, so six shards cover the
 * library without coordinating.
 */
function parseShard(argv: readonly string[]): { index: number; total: number } {
  const flag = argv.indexOf('--shard')
  if (flag === -1) return { index: 0, total: 1 }
  const parts = (argv[flag + 1] ?? '').split('/').map(Number)
  const index = parts[0] ?? NaN
  const total = parts[1] ?? NaN
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    index < 1 ||
    index > total
  ) {
    throw new Error('--shard needs the form i/n, 1-based, for example 2/6')
  }
  return { index: index - 1, total }
}

function parseLimit(argv: readonly string[]): number {
  const flag = argv.indexOf('--limit')
  if (flag === -1) return DEFAULT_LIMIT
  const value = Number(argv[flag + 1])
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--limit needs a positive whole number')
  }
  return value
}

async function main() {
  const apply = process.argv.includes('--apply')
  const limit = parseLimit(process.argv)
  const shard = parseShard(process.argv)

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
        pdfKey: renderedPdf.r2Key,
      })
      .from(documentVersions)
      .innerJoin(attachments, eq(attachments.id, documentVersions.docxAttachmentId))
      .leftJoin(renderedPdf, eq(renderedPdf.id, documentVersions.pdfAttachmentId))
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(isNotNull(documentVersions.docxAttachmentId)),
  )

  const mine = (candidates as Candidate[]).filter(
    (_, position) => position % shard.total === shard.index,
  )
  const label = shard.total > 1 ? ` [shard ${shard.index + 1}/${shard.total}]` : ''
  console.log(
    `${mine.length} of ${candidates.length} version(s) in scope${label}; at most ${limit}`,
  )

  let converted = 0
  let alreadyCorrect = 0
  let failed = 0
  let remaining = 0

  for (const row of mine) {
    if (converted >= limit) {
      remaining++
      continue
    }
    const label = `${row.docKey || row.docTitle} v${row.version}`
    try {
      const docx = await getObject({ key: row.docxKey })
      const structureDone = await isNormalizedDocx(docx, TARGET)
      const rendered = row.pdfKey
        ? await measureRenderedType(await getObject({ key: row.pdfKey }))
        : null
      const bandDone = reservesBand(rendered?.firstPageTopPt ?? null)
      const indentReduce = indentReduceTwips(rendered?.bodyLeftPt ?? null)
      if (structureDone && bandDone && indentReduce === 0) {
        alreadyCorrect++
        continue
      }

      if (!apply) {
        console.log(`  would ${structureDone ? 're-render' : 'normalise'} ${label}`)
        converted++
        continue
      }

      // Scale by what the render MEASURED, so documents in different typefaces
      // end up looking the same size rather than merely declaring the same one.
      // A master that is already on the house typography keeps it: re-deriving
      // the factor from a scaled document would scale it a second time.
      let bodyPtBefore: number | null = null
      let sizeFactor = 1
      if (!structureDone) {
        bodyPtBefore = (await measureRender(docx)).bodyPt
        if (bodyPtBefore) sizeFactor = TARGET_BODY_PT / bodyPtBefore
      }
      const master = await normalizeDocxTypography(docx, TARGET, {
        sizeFactor,
        indentReduceTwips: indentReduce,
      })
      // The same path the render worker uses, so a re-rendered snapshot and a
      // freshly saved one cannot drift apart.
      const pdf = await renderDocxToPdf(master)

      const base =
        (row.docKey || row.docTitle || 'document')
          .replace(/[^\w.\- ]+/g, '')
          .trim()
          .slice(0, 180) || 'document'
      const docxName = `${base}-v${row.version}.docx`
      const pdfName = `${base}-v${row.version}.pdf`
      const pdfObjectKey = newAttachmentKey({
        tenantId: row.tenantId,
        kind: 'document',
        filename: pdfName,
      })
      await putObject({
        key: pdfObjectKey,
        body: pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })

      // Only when the master itself changed: a re-render leaves the stored
      // DOCX and its extracted text exactly as they were.
      const changedMaster = master !== docx
      let docxObjectKey: string | null = null
      let text: string | null = null
      if (changedMaster) {
        text = (await sofficeConvert(master, 'document.docx', 'txt:Text'))
          .toString('utf8')
          .slice(0, MAX_TEXT_CHARS)
        docxObjectKey = newAttachmentKey({
          tenantId: row.tenantId,
          kind: 'document',
          filename: docxName,
        })
        await putObject({ key: docxObjectKey, body: master, contentType: DOCX_MIME })
      }

      await withTenant(db, row.tenantId, async (tx) => {
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
        if (!pdfAtt) throw new Error('Failed to store the rendered PDF')
        let docxAttachmentId: string | null = null
        if (docxObjectKey) {
          const [docxAtt] = await tx
            .insert(attachments)
            .values({
              tenantId: row.tenantId,
              kind: 'document',
              r2Key: docxObjectKey,
              contentType: DOCX_MIME,
              sizeBytes: master.length,
              filename: docxName,
            })
            .returning()
          if (!docxAtt) throw new Error('Failed to store the converted master')
          docxAttachmentId = docxAtt.id
        }
        await tx
          .update(documentVersions)
          .set({
            ...(docxAttachmentId ? { docxAttachmentId } : {}),
            ...(text !== null ? { textContent: text } : {}),
            pdfAttachmentId: pdfAtt.id,
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
          summary: changedMaster
            ? `Normalised version ${row.version} to the house page and typography`
            : `Re-rendered version ${row.version} with the controlled-header reserve`,
          metadata: {
            versionId: row.versionId,
            bodyPtBefore,
            bodyPtTarget: TARGET_BODY_PT,
            indentReduceTwips: indentReduce,
          },
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
  if (remaining > 0) {
    console.log(`${remaining} still to do — run again to continue.`)
  }
  if (!apply) console.log('Re-run with --apply to write the changes.')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
