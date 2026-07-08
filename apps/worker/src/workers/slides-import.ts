// PowerPoint → slides render (import + master-copy re-render).
//
// Converts a .pptx into pixel-perfect per-slide PNG images and REPLACES the
// Slide[] deck on a training lesson or library content item, marking the pptx
// attachment as the deck's master copy (sourceAttachmentId). The same job runs
// for the initial import and for every re-render after the master is edited in
// the in-browser PowerPoint editor (Collabora save → WOPI PutFile):
//
//   pptx ─(soffice --headless)→ pdf ─(pdftoppm)→ slide-N.png → attachments
//
// Concurrency: PutFile enqueues renders with unique job ids, so two renders of
// the same deck can overlap. Before persisting, the worker re-reads the master
// attachment's updatedAt — if the file changed since this render started, the
// result is stale and is discarded (the newer save's own job persists instead).
//
// Requires LibreOffice (soffice) + poppler (pdftoppm) on the worker host —
// both are in the production image; locally `brew install --cask libreoffice`
// + `brew install poppler`. Missing binaries surface as importStatus='failed'
// with a human-readable importError, never a crash loop (attempts: 1).

import { mkdtemp, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import JSZip from 'jszip'
import { db, withTenant } from '@beaconhs/db'
import {
  attachments,
  renderedPageAttachmentIds,
  trainingContentItems,
  trainingLessons,
  type Slide,
} from '@beaconhs/db/schema'
import { deleteObject, getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { exec, resolveSoffice } from '@beaconhs/office'

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** Extract the visible text runs from a notes-slide XML document. */
function notesTextFromXml(xml: string): string {
  // Placeholder fields (<a:fld> — slide number, date) carry literal artifact
  // text like "<number>"; LibreOffice adds one to every notes slide it saves.
  // Drop the fields entirely, then collect the real <a:t>…</a:t> runs.
  const withoutFields = xml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, '')
  const runs = [...withoutFields.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((r) =>
    decodeXmlEntities(r[1] ?? ''),
  )
  const text = runs.join(' ').replace(/\s+/g, ' ').trim()
  return text && !/^\d+$/.test(text) ? text : ''
}

/**
 * Pull speaker notes out of the pptx zip, keyed by SLIDE POSITION (1-based, in
 * presentation order). The slide↔notesSlide association is defined by each
 * slide's _rels relationships — notes files are numbered in creation order, so
 * notesSlide1.xml can belong to slide 3 when only slide 3 has notes. Resolution
 * order: presentation.xml sldIdLst (slide order) → slideN.xml.rels (notesSlide
 * target) → notesSlideM.xml (text). Falls back to the filename-index heuristic
 * for decks whose relationship parts are missing or malformed.
 */
async function extractNotes(pptx: Buffer): Promise<Map<number, string>> {
  const notes = new Map<number, string>()
  try {
    const zip = await JSZip.loadAsync(pptx)
    const read = (name: string) => zip.files[name]?.async('string') ?? null

    // 1. Slide order: presentation.xml sldIdLst r:id refs → presentation rels targets.
    const orderedSlideFiles: string[] = []
    const presXml = await read('ppt/presentation.xml')
    const presRelsXml = await read('ppt/_rels/presentation.xml.rels')
    if (presXml && presRelsXml) {
      const relTargets = new Map<string, string>()
      for (const rel of presRelsXml.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = rel[0]
        const relId = tag.match(/\bId="([^"]+)"/)?.[1]
        const target = tag.match(/\bTarget="([^"]+)"/)?.[1]
        if (relId && target) relTargets.set(relId, target)
      }
      for (const sld of presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>/g)) {
        const target = relTargets.get(sld[1]!)
        if (!target) continue
        const normalized = target.replace(/^\/?(ppt\/)?/, 'ppt/').replace(/^ppt\/\.\.\//, '')
        if (/^ppt\/slides\/slide\d+\.xml$/.test(normalized)) orderedSlideFiles.push(normalized)
      }
    }

    if (orderedSlideFiles.length > 0) {
      // 2. Per-slide rels: find each slide's notesSlide target and read its text.
      for (let position = 0; position < orderedSlideFiles.length; position++) {
        const slideFile = orderedSlideFiles[position]!
        const slideName = slideFile.slice('ppt/slides/'.length)
        const relsXml = await read(`ppt/slides/_rels/${slideName}.rels`)
        if (!relsXml) continue
        const target = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)]
          .map((r) => r[0])
          .filter((tag) => /\bType="[^"]*\/notesSlide"/.test(tag))
          .map((tag) => tag.match(/\bTarget="([^"]+)"/)?.[1])
          .find((t): t is string => !!t)
        if (!target) continue
        const notesFile = `ppt/notesSlides/${target.replace(/^(\.\.\/)*notesSlides\//, '')}`
        const xml = await read(notesFile)
        if (!xml) continue
        const text = notesTextFromXml(xml)
        if (text) notes.set(position + 1, text)
      }
      return notes
    }

    // 3. Fallback: assume notesSlideN.xml index == slide position (older decks
    // exported with dense sequential notes parts).
    for (const name of Object.keys(zip.files)) {
      const m = name.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)
      if (!m) continue
      const text = notesTextFromXml(await zip.files[name]!.async('string'))
      if (text) notes.set(Number(m[1]), text)
    }
  } catch {
    // Notes are best-effort — a malformed zip should not fail the import.
  }
  return notes
}

/** Best-effort delete of a render's page-image attachments (rows + objects). */
async function gcRenderedPages(tenantId: string, slides: Slide[]): Promise<void> {
  const ids = renderedPageAttachmentIds(slides)
  if (ids.length === 0) return
  try {
    const rows = await withTenant(db, tenantId, async (tx) => {
      const found = await tx
        .select({ id: attachments.id, key: attachments.r2Key })
        .from(attachments)
        .where(inArray(attachments.id, ids))
      if (found.length > 0) {
        await tx.delete(attachments).where(
          inArray(
            attachments.id,
            found.map((r) => r.id),
          ),
        )
      }
      return found
    })
    await Promise.all(rows.map((r) => deleteObject({ key: r.key }).catch(() => {})))
  } catch (err) {
    console.warn('[slides-import] page-image GC failed (continuing):', err)
  }
}

type Target = { table: typeof trainingLessons | typeof trainingContentItems; label: string }

function targetFor(kind: 'lesson' | 'content_item'): Target {
  return kind === 'lesson'
    ? { table: trainingLessons, label: 'training_lesson' }
    : { table: trainingContentItems, label: 'training_content_item' }
}

export async function importSlidesFromPptx(args: {
  tenantId: string
  target: 'lesson' | 'content_item'
  targetId: string
  attachmentId: string
}): Promise<void> {
  const { tenantId, targetId, attachmentId } = args
  const { table, label } = targetFor(args.target)

  const setStatus = (status: string, error: string | null = null) =>
    withTenant(db, tenantId, async (tx) => {
      await tx
        .update(table)
        .set({ importStatus: status, importError: error })
        .where(eq(table.id, targetId))
    })

  await setStatus('processing')

  let workDir: string | null = null
  try {
    // 1. Fetch the pptx master. updatedAt is the render's version stamp: a
    // WOPI save bumps it, so a mismatch at persist time means this render is
    // stale.
    const att = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          key: attachments.r2Key,
          filename: attachments.filename,
          updatedAt: attachments.updatedAt,
        })
        .from(attachments)
        .where(eq(attachments.id, attachmentId))
        .limit(1)
      return row ?? null
    })
    if (!att?.key) throw new Error('Uploaded PowerPoint file not found')
    const renderedVersion = att.updatedAt?.getTime() ?? 0
    const pptx = await getObject({ key: att.key })

    // 2. Convert: pptx → pdf → per-page PNGs.
    const soffice = await resolveSoffice()
    workDir = await mkdtemp(join(tmpdir(), 'bhs-pptx-'))
    const srcPath = join(workDir, 'deck.pptx')
    await writeFile(srcPath, pptx)
    await exec(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', workDir, srcPath], {
      timeout: 180_000,
      env: { ...process.env, HOME: workDir }, // soffice needs a writable profile dir
    })
    const pdfPath = join(workDir, 'deck.pdf')
    await access(pdfPath).catch(() => {
      throw new Error('LibreOffice did not produce a PDF from the PowerPoint file')
    })
    await exec('pdftoppm', ['-png', '-r', '144', pdfPath, join(workDir, 'slide')], {
      timeout: 180_000,
    })
    const pageFiles = (await readdir(workDir))
      .filter((f) => /^slide-?\d+\.png$/.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\.png$/)?.[1] ?? 0)
        const nb = Number(b.match(/(\d+)\.png$/)?.[1] ?? 0)
        return na - nb
      })
    if (pageFiles.length === 0) throw new Error('No slides found in the PowerPoint file')

    // 3. Speaker notes (best-effort).
    const notes = await extractNotes(pptx)

    // 4. Upload each page as an attachment + build the Slide[].
    const baseName = (att.filename ?? 'slides').replace(/\.pptx?$/i, '')
    const imported: Slide[] = []
    for (let i = 0; i < pageFiles.length; i++) {
      const png = await readFile(join(workDir, pageFiles[i]!))
      const key = newAttachmentKey({
        tenantId,
        kind: 'image',
        filename: `${baseName}-slide-${i + 1}.png`,
      })
      await putObject({ key, body: png, contentType: 'image/png' })
      const attachmentRowId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(attachments)
          .values({
            tenantId,
            kind: 'image',
            r2Key: key,
            contentType: 'image/png',
            sizeBytes: png.length,
            filename: `${baseName}-slide-${i + 1}.png`,
          })
          .returning()
        return row?.id ?? null
      })
      if (!attachmentRowId) throw new Error('Failed to store a converted slide image')
      // Canvas slide with a locked full-bleed page render — the Fabric editor
      // lets authors annotate on top without disturbing the imported page.
      imported.push({
        id: randomUUID(),
        layout: 'canvas',
        bgColor: '#ffffff',
        elements: [
          {
            id: randomUUID(),
            kind: 'image',
            attachmentId: attachmentRowId,
            x: 0,
            y: 0,
            w: 960,
            h: 540,
            fit: 'contain',
            locked: true,
          },
        ],
        notes: notes.get(i + 1),
      })
    }

    // 5. Replace the deck (the pptx is the master copy — slides are a derived
    // render) + mark complete. Skipped when the master changed mid-render: the
    // newer save's own render job persists the up-to-date result.
    const superseded = await withTenant(db, tenantId, async (tx) => {
      const [current] = await tx
        .select({ updatedAt: attachments.updatedAt })
        .from(attachments)
        .where(eq(attachments.id, attachmentId))
        .limit(1)
      if ((current?.updatedAt?.getTime() ?? 0) !== renderedVersion) return null

      const [row] = await tx
        .select({ slides: table.slides })
        .from(table)
        .where(eq(table.id, targetId))
        .limit(1)
      const previous = (row?.slides ?? []) as Slide[]
      await tx
        .update(table)
        .set({
          slides: imported,
          sourceAttachmentId: attachmentId,
          importStatus: 'complete',
          importError: null,
        })
        .where(eq(table.id, targetId))
      await audit(tx, {
        tenantId,
        entityType: label,
        entityId: targetId,
        action: 'update',
        summary: `Rendered ${imported.length} slide${imported.length === 1 ? '' : 's'} from PowerPoint "${att.filename ?? 'deck.pptx'}"`,
        metadata: { slideCount: imported.length, sourceAttachmentId: attachmentId },
      })
      return previous
    })

    if (superseded === null) {
      // Stale render — throw away the page images we just uploaded.
      await gcRenderedPages(tenantId, imported)
      console.log(`[slides-import] ${label} ${targetId}: master changed mid-render, discarded`)
      return
    }

    // 6. GC the previous render's page images (each save would otherwise leak
    // one PNG per slide). Only attachments matching the import-render pattern
    // are touched — they are created solely by this worker and never reused.
    await gcRenderedPages(tenantId, superseded)
    console.log(`[slides-import] ${label} ${targetId}: rendered ${imported.length} slides`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PowerPoint import failed'
    console.error(`[slides-import] ${label} ${targetId} failed:`, message)
    await setStatus('failed', message).catch(() => {})
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
