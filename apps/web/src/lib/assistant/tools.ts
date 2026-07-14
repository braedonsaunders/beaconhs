// Read & search tools for the assistant. Every record-bearing tool applies the
// SAME permission-tier predicate its module list uses (`moduleScopeWhere`, plus
// `recordVisibilityWhere` for the people directory picker) so the agent only
// ever returns rows the current user could see in the UI — the engines are
// RLS-tenant-isolated but NOT record-visibility-scoped, so this is the
// load-bearing safety boundary.
//
// Row caps are deliberately small; lists report a `total` so the model can
// answer "how many" and tell the user to narrow rather than paging blindly.

import { z } from 'zod'
import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import { primaryPersonTitleName } from '@beaconhs/db'
import {
  correctiveActions,
  documentCategories,
  documents,
  incidents,
  people,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { manualArticleForUser, searchManualArticles } from '@/lib/manual/registry'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { moduleScopeWhere, recordVisibilityWhere } from '@/lib/visibility'
import { documentReadFilter } from './doc-access'
import { getDocumentPdfBytes, getDocumentText } from './document-content'
import { truncateText, type AssistantToolDef, type ToolImage, type ToolResult } from './types'

// ---- helpers ---------------------------------------------------------------

function escLike(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`)
}
function like(q: string): string {
  return `%${escLike(q.slice(0, 100))}%`
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const INCIDENT_STATUS = [
  'reported',
  'under_investigation',
  'pending_review',
  'closed',
  'reopened',
] as const
const INCIDENT_SEVERITY = [
  'first_aid_only',
  'medical_aid',
  'lost_time',
  'fatality',
  'no_injury',
] as const
const INCIDENT_TYPE = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const
const CA_STATUS = ['open', 'in_progress', 'pending_verification', 'closed', 'cancelled'] as const
const CA_SEVERITY = ['low', 'medium', 'high', 'critical'] as const

// ---- tools -----------------------------------------------------------------

const whoami: AssistantToolDef = {
  name: 'whoami',
  description:
    'Return the current user: their permissions, role scopes, super-admin / impersonation state, and whether they can draft changes. Call this first when unsure what the user is allowed to see or do.',
  category: 'read',
  gate: { mode: 'public' },
  inputSchema: z.object({}),
  execute: async (_args, ctx): Promise<ToolResult> => ({
    ok: true,
    data: {
      isSuperAdmin: ctx.isSuperAdmin,
      impersonating: Boolean(ctx.impersonation),
      canDraftChanges: can(ctx, 'assistant.write'),
      scopes: ctx.scopes,
      permissions: Array.from(ctx.permissions).sort(),
    },
  }),
}

const findIncidents: AssistantToolDef = {
  name: 'find_incidents',
  description:
    'List incident reports the user may see, with optional filters (free-text, status, severity, type, occurred within N days). Returns a capped list plus the total match count. Read-only.',
  category: 'read',
  gate: {
    mode: 'anyOf',
    perms: ['incidents.read.all', 'incidents.read.site', 'incidents.read.self'],
  },
  inputSchema: z.object({
    query: z.string().max(100).optional(),
    status: z.enum(INCIDENT_STATUS).optional(),
    severity: z.enum(INCIDENT_SEVERITY).optional(),
    type: z.enum(INCIDENT_TYPE).optional(),
    withinDays: z.number().int().min(1).max(3650).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as {
      query?: string
      status?: (typeof INCIDENT_STATUS)[number]
      severity?: (typeof INCIDENT_SEVERITY)[number]
      type?: (typeof INCIDENT_TYPE)[number]
      withinDays?: number
      limit?: number
    }
    const limit = Math.min(a.limit ?? 20, 50)
    return ctx.db(async (tx) => {
      const conds: SQL[] = [isNull(incidents.deletedAt)]
      if (a.query) {
        const t = like(a.query)
        const m = or(
          ilike(incidents.reference, t),
          ilike(incidents.title, t),
          ilike(incidents.description, t),
        )
        if (m) conds.push(m)
      }
      if (a.status) conds.push(eq(incidents.status, a.status))
      if (a.severity) conds.push(eq(incidents.severity, a.severity))
      if (a.type) conds.push(eq(incidents.type, a.type))
      if (a.withinDays)
        conds.push(gte(incidents.occurredAt, new Date(Date.now() - a.withinDays * 86_400_000)))
      // Same tiered predicate as the /incidents list (moduleScopeWhere).
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
      })
      if (vis) conds.push(vis)
      const where = and(...conds)
      const [rows, totalRow] = await Promise.all([
        tx
          .select({
            id: incidents.id,
            reference: incidents.reference,
            title: incidents.title,
            type: incidents.type,
            severity: incidents.severity,
            status: incidents.status,
            occurredAt: incidents.occurredAt,
          })
          .from(incidents)
          .where(where)
          .orderBy(desc(incidents.occurredAt))
          .limit(limit),
        tx.select({ c: count() }).from(incidents).where(where),
      ])
      const total = Number(totalRow[0]?.c ?? 0)
      return {
        ok: true,
        data: {
          total,
          returned: rows.length,
          truncated: total > rows.length,
          items: rows.map((r) => ({
            id: r.id,
            reference: r.reference,
            title: r.title,
            type: r.type,
            severity: r.severity,
            status: r.status,
            occurredAt: r.occurredAt?.toISOString() ?? null,
          })),
        },
      }
    })
  },
}

const getIncident: AssistantToolDef = {
  name: 'get_incident',
  description:
    'Fetch the full detail of one incident by id. Returns not_found if the user may not see it. Read-only.',
  category: 'read',
  gate: {
    mode: 'anyOf',
    perms: ['incidents.read.all', 'incidents.read.site', 'incidents.read.self'],
  },
  inputSchema: z.object({ id: z.string().uuid() }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string }
    return ctx.db(async (tx) => {
      const conds: SQL[] = [eq(incidents.id, a.id), isNull(incidents.deletedAt)]
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
      })
      if (vis) conds.push(vis)
      const [row] = await tx
        .select({
          id: incidents.id,
          reference: incidents.reference,
          title: incidents.title,
          description: incidents.description,
          type: incidents.type,
          severity: incidents.severity,
          status: incidents.status,
          occurredAt: incidents.occurredAt,
          reportedAt: incidents.reportedAt,
          location: incidents.location,
        })
        .from(incidents)
        .where(and(...conds))
        .limit(1)
      if (!row) return { ok: false, error: 'not_found' }
      return {
        ok: true,
        data: {
          ...row,
          description: truncateText(row.description, 4000),
          occurredAt: row.occurredAt?.toISOString() ?? null,
          reportedAt: row.reportedAt?.toISOString() ?? null,
        },
      }
    })
  },
}

const findCorrectiveActions: AssistantToolDef = {
  name: 'find_corrective_actions',
  description:
    'List corrective actions the user may see, with optional filters (free-text, status, severity, overdue-only). Returns a capped list plus the total match count. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['ca.read.all', 'ca.read.site', 'ca.read.self'] },
  inputSchema: z.object({
    query: z.string().max(100).optional(),
    status: z.enum(CA_STATUS).optional(),
    severity: z.enum(CA_SEVERITY).optional(),
    overdueOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as {
      query?: string
      status?: (typeof CA_STATUS)[number]
      severity?: (typeof CA_SEVERITY)[number]
      overdueOnly?: boolean
      limit?: number
    }
    const limit = Math.min(a.limit ?? 20, 50)
    return ctx.db(async (tx) => {
      const conds: SQL[] = [isNull(correctiveActions.deletedAt)]
      if (a.query) {
        const t = like(a.query)
        const m = or(ilike(correctiveActions.reference, t), ilike(correctiveActions.title, t))
        if (m) conds.push(m)
      }
      if (a.status) conds.push(eq(correctiveActions.status, a.status))
      if (a.severity) conds.push(eq(correctiveActions.severity, a.severity))
      if (a.overdueOnly) {
        conds.push(lt(correctiveActions.dueOn, todayIso()))
        conds.push(
          inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
        )
      }
      // Same tiered predicate as the /corrective-actions list (moduleScopeWhere).
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'ca',
        ownerCols: [correctiveActions.ownerTenantUserId],
        siteCol: correctiveActions.siteOrgUnitId,
      })
      if (vis) conds.push(vis)
      const where = and(...conds)
      const [rows, totalRow] = await Promise.all([
        tx
          .select({
            id: correctiveActions.id,
            reference: correctiveActions.reference,
            title: correctiveActions.title,
            severity: correctiveActions.severity,
            status: correctiveActions.status,
            dueOn: correctiveActions.dueOn,
          })
          .from(correctiveActions)
          .where(where)
          .orderBy(desc(correctiveActions.createdAt))
          .limit(limit),
        tx.select({ c: count() }).from(correctiveActions).where(where),
      ])
      const total = Number(totalRow[0]?.c ?? 0)
      return {
        ok: true,
        data: { total, returned: rows.length, truncated: total > rows.length, items: rows },
      }
    })
  },
}

const getCorrectiveAction: AssistantToolDef = {
  name: 'get_corrective_action',
  description:
    'Fetch the full detail of one corrective action by id. Returns not_found if the user may not see it. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['ca.read.all', 'ca.read.site', 'ca.read.self'] },
  inputSchema: z.object({ id: z.string().uuid() }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string }
    return ctx.db(async (tx) => {
      const conds: SQL[] = [eq(correctiveActions.id, a.id), isNull(correctiveActions.deletedAt)]
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'ca',
        ownerCols: [correctiveActions.ownerTenantUserId],
        siteCol: correctiveActions.siteOrgUnitId,
      })
      if (vis) conds.push(vis)
      const [row] = await tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
          description: correctiveActions.description,
          severity: correctiveActions.severity,
          status: correctiveActions.status,
          source: correctiveActions.source,
          assignedOn: correctiveActions.assignedOn,
          dueOn: correctiveActions.dueOn,
        })
        .from(correctiveActions)
        .where(and(...conds))
        .limit(1)
      if (!row) return { ok: false, error: 'not_found' }
      return { ok: true, data: { ...row, description: truncateText(row.description, 4000) } }
    })
  },
}

const findDocuments: AssistantToolDef = {
  name: 'find_documents',
  description:
    'List controlled documents (metadata only: key, title, category, status, next review date). Use to find a document id, then read_document for its content. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['documents.read', 'documents.manage'] },
  inputSchema: z.object({
    query: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { query?: string; limit?: number }
    const limit = Math.min(a.limit ?? 25, 50)
    return ctx.db(async (tx) => {
      const conds: SQL[] = [isNull(documents.deletedAt)]
      const pubOnly = documentReadFilter(ctx)
      if (pubOnly) conds.push(pubOnly)
      if (a.query) {
        const t = like(a.query)
        const m = or(ilike(documents.title, t), ilike(documents.key, t))
        if (m) conds.push(m)
      }
      const where = and(...conds)
      const [rows, totalRow] = await Promise.all([
        tx
          .select({
            id: documents.id,
            key: documents.key,
            title: documents.title,
            category: documentCategories.name,
            status: documents.status,
            nextReviewOn: documents.nextReviewOn,
          })
          .from(documents)
          .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
          .where(where)
          .orderBy(documents.title)
          .limit(limit),
        tx.select({ c: count() }).from(documents).where(where),
      ])
      const total = Number(totalRow[0]?.c ?? 0)
      return {
        ok: true,
        data: { total, returned: rows.length, truncated: total > rows.length, items: rows },
      }
    })
  },
}

const READ_DOC_WINDOW = 14_000

const readDocument: AssistantToolDef = {
  name: 'read_document',
  description:
    'Read a controlled document’s full content as plain text — including large uploaded PDFs, whose text is extracted on demand. Returns a window of the text: pass `offset` to page through a long document (the result reports totalChars, hasMore and nextOffset). To jump to the relevant part of a big document, call search_document first, then read_document at the returned offset. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['documents.read', 'documents.manage'] },
  inputSchema: z.object({
    id: z.string().uuid(),
    offset: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(500).max(20_000).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string; offset?: number; maxChars?: number }
    const res = await getDocumentText(ctx, a.id)
    if (!res.ok) return { ok: false, error: res.error }
    const doc = res.doc
    const total = doc.text.length
    const offset = Math.min(a.offset ?? 0, total)
    const window = Math.min(a.maxChars ?? READ_DOC_WINDOW, 20_000)
    const chunk = doc.text.slice(offset, offset + window)
    const end = offset + chunk.length
    const hasMore = end < total
    return {
      ok: true,
      data: {
        id: doc.id,
        key: doc.key,
        title: doc.title,
        status: doc.status,
        source: doc.source,
        pages: doc.pages,
        totalChars: total,
        offset,
        returnedChars: chunk.length,
        hasMore,
        nextOffset: hasMore ? end : null,
        text: chunk,
      },
      note: doc.scanned
        ? 'This appears to be a scanned/image-only PDF — little or no text could be extracted. Tell the user to open it in the reader to view the pages.'
        : total === 0
          ? 'This document has no readable text content yet.'
          : undefined,
    }
  },
}

// How many pages a single view_document_pages call may rasterize (token budget)
// and the target raster width in px (~150 DPI for a Letter/A4 page — enough for
// the model to read body text without bloating the image token cost).
const VIEW_PAGES_MAX = 5
const VIEW_PAGES_WIDTH = 1240

const viewDocumentPages: AssistantToolDef = {
  name: 'view_document_pages',
  description:
    'View the actual PAGES of a scanned / image-only PDF as images, so you can READ a document that has no extractable text layer (read_document/search_document return nothing for these). Pass a page range — a few pages per call (max 5). Use this ONLY when read_document or search_document reported the document is scanned. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['documents.read', 'documents.manage'] },
  // Returns page images for the model to SEE — withheld unless the provider
  // accepts image content in tool results (Anthropic). See registry.ts.
  needsImageToolResults: true,
  inputSchema: z.object({
    id: z.string().uuid(),
    fromPage: z.number().int().min(1),
    toPage: z.number().int().min(1),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string; fromPage: number; toPage: number }
    // Metadata first (cached by getDocumentText): confirms it's a scanned PDF and
    // gives the page count, so we never rasterize a document with a text layer.
    const meta = await getDocumentText(ctx, a.id)
    if (!meta.ok) return { ok: false, error: meta.error }
    const { source, pages, scanned, title } = meta.doc
    if (source !== 'pdf' || !pages) {
      return {
        ok: true,
        data: {
          images: [] as ToolImage[],
          summary: `“${title}” is not an uploaded PDF, so there are no pages to render. Use read_document for its text.`,
        },
      }
    }
    if (!scanned) {
      return {
        ok: true,
        data: {
          images: [] as ToolImage[],
          summary: `“${title}” has an extractable text layer — use read_document or search_document to read it as text instead of rendering page images.`,
        },
      }
    }

    // Clamp to the real page range and cap the span so one call can't blow the
    // image-token budget on a hundreds-of-page scan.
    const from = Math.min(Math.max(1, Math.floor(a.fromPage)), pages)
    let to = Math.min(Math.max(from, Math.floor(a.toPage)), pages)
    let capped = false
    if (to - from + 1 > VIEW_PAGES_MAX) {
      to = from + VIEW_PAGES_MAX - 1
      capped = true
    }

    const bytesRes = await getDocumentPdfBytes(ctx, a.id)
    if (!bytesRes.ok) return { ok: false, error: bytesRes.error }

    let images: ToolImage[]
    try {
      // Lazy import keeps unpdf + the native canvas backend off every other path.
      const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(bytesRes.bytes))
      const rendered: ToolImage[] = []
      for (let n = from; n <= to; n++) {
        const dataUrl = await renderPageAsImage(pdf, n, {
          canvasImport: () => import('@napi-rs/canvas'),
          width: VIEW_PAGES_WIDTH,
          toDataURL: true,
        })
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        if (base64) rendered.push({ mediaType: 'image/png', base64 })
      }
      images = rendered
    } catch (e) {
      console.warn(`[assistant] page render failed for ${a.id}`, e)
      return { ok: false, error: 'render_failed' }
    }

    const span = from === to ? `page ${from}` : `pages ${from}–${to}`
    const summary =
      `Rendered ${span} of ${pages} from the scanned PDF “${title}” as ${images.length} image(s). ` +
      `Read the text directly from these page images.` +
      (capped ? ` (Range capped to ${VIEW_PAGES_MAX} pages per call.)` : '') +
      (to < pages ? ` Pages ${to + 1}–${pages} are not shown — call again to view more.` : '')

    return {
      ok: true,
      data: {
        images,
        summary,
        title,
        pages,
        fromPage: from,
        toPage: to,
        renderedPages: images.length,
      },
    }
  },
}

/** Locate the PDF page a character offset falls on, using the `[Page N]` markers
 *  getDocumentText inserts. Returns null for non-PDF text. */
function pageForOffset(text: string, offset: number): number | null {
  const re = /\[Page (\d+)\]/g
  let page: number | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > offset) break
    page = Number(m[1])
  }
  return page
}

const searchDocument: AssistantToolDef = {
  name: 'search_document',
  description:
    'Search WITHIN a single controlled document (including large multi-page PDFs) for a word or phrase, returning the matching passages with their character offset and page number. Use this to find the relevant section of a long document before reading it, then call read_document at the returned offset. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['documents.read', 'documents.manage'] },
  inputSchema: z.object({
    id: z.string().uuid(),
    query: z.string().min(2).max(200),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string; query: string; maxResults?: number }
    const res = await getDocumentText(ctx, a.id)
    if (!res.ok) return { ok: false, error: res.error }
    const doc = res.doc
    const limit = Math.min(a.maxResults ?? 8, 20)
    if (!doc.text) {
      return {
        ok: true,
        data: { id: doc.id, key: doc.key, title: doc.title, totalMatches: 0, matches: [] },
        note: doc.scanned
          ? 'This appears to be a scanned/image-only PDF — its text could not be searched. Tell the user to open it in the reader.'
          : 'This document has no readable text content to search.',
      }
    }
    const hay = doc.text.toLowerCase()
    const needle = a.query.toLowerCase()
    const CONTEXT = 160
    const matches: { offset: number; page: number | null; snippet: string }[] = []
    let total = 0
    let from = 0
    for (;;) {
      const pos = hay.indexOf(needle, from)
      if (pos === -1) break
      total += 1
      if (matches.length < limit) {
        const start = Math.max(0, pos - CONTEXT)
        const snippet = doc.text
          .slice(start, pos + needle.length + CONTEXT)
          .replace(/\s+/g, ' ')
          .trim()
        matches.push({
          offset: pos,
          page: pageForOffset(doc.text, pos),
          snippet: `${start > 0 ? '…' : ''}${snippet}…`,
        })
      }
      from = pos + needle.length
      // Cap the scan so a pathological query can't spin forever.
      if (total > 5000) break
    }
    return {
      ok: true,
      data: {
        id: doc.id,
        key: doc.key,
        title: doc.title,
        source: doc.source,
        pages: doc.pages,
        totalChars: doc.text.length,
        totalMatches: total,
        returned: matches.length,
        matches,
      },
      note:
        total === 0
          ? `No matches for “${a.query}”. Try a shorter or different term, or read_document to skim it.`
          : undefined,
    }
  },
}

const findPeople: AssistantToolDef = {
  name: 'find_people',
  description:
    'Find active people in the directory by name, employee number, or email. Returns id, name, employee number and job title. Use to resolve a person id for other tools. Read-only.',
  category: 'read',
  gate: {
    mode: 'anyOf',
    perms: ['training.read.all', 'incidents.read.site', 'ca.read.site', 'admin.users.manage'],
  },
  inputSchema: z.object({
    query: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { query: string; limit?: number }
    const limit = Math.min(a.limit ?? 15, 25)
    return ctx.db(async (tx) => {
      const t = like(a.query)
      const conds: SQL[] = [isNull(people.deletedAt), eq(people.status, 'active')]
      const m = or(
        ilike(people.firstName, t),
        ilike(people.lastName, t),
        ilike(people.employeeNo, t),
        ilike(people.email, t),
      )
      if (m) conds.push(m)
      const vis = await recordVisibilityWhere(ctx, tx, { personCol: people.id })
      if (vis) conds.push(vis)
      const rows = await tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
          jobTitle: primaryPersonTitleName(people.id, people.tenantId),
        })
        .from(people)
        .where(and(...conds))
        .orderBy(people.lastName, people.firstName)
        .limit(limit)
      return {
        ok: true,
        data: {
          returned: rows.length,
          items: rows.map((r) => ({
            id: r.id,
            name: `${r.firstName} ${r.lastName}`.trim(),
            employeeNo: r.employeeNo,
            jobTitle: r.jobTitle,
          })),
        },
      }
    })
  },
}

const findTrainingRecords: AssistantToolDef = {
  name: 'find_training_records',
  description:
    'List training records the user may see, optionally for one person or expiring within N days. Expiry queries only count the latest record per person and course (retraining supersedes older records). Includes course name and expiry. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['training.read.all', 'training.read.self'] },
  inputSchema: z.object({
    personId: z.string().uuid().optional(),
    expiringWithinDays: z.number().int().min(1).max(3650).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { personId?: string; expiringWithinDays?: number; limit?: number }
    const limit = Math.min(a.limit ?? 25, 50)
    return ctx.db(async (tx) => {
      const conds: SQL[] = [isNull(trainingRecords.deletedAt)]
      if (a.personId) conds.push(eq(trainingRecords.personId, a.personId))
      if (a.expiringWithinDays) {
        const horizon = new Date(Date.now() + a.expiringWithinDays * 86_400_000)
          .toISOString()
          .slice(0, 10)
        conds.push(lt(trainingRecords.expiresOn, horizon))
        // An expiry query is about CURRENT standing — superseded records
        // (retrained since) must not be reported as expiring/expired.
        conds.push(latestTrainingRecordOnly())
      }
      // Same tiered predicate as the /training/records list (moduleScopeWhere).
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'training',
        personCol: trainingRecords.personId,
      })
      if (vis) conds.push(vis)
      const where = and(...conds)
      const [rows, totalRow] = await Promise.all([
        tx
          .select({
            id: trainingRecords.id,
            personId: trainingRecords.personId,
            firstName: people.firstName,
            lastName: people.lastName,
            course: trainingCourses.name,
            completedOn: trainingRecords.completedOn,
            expiresOn: trainingRecords.expiresOn,
            grade: trainingRecords.grade,
          })
          .from(trainingRecords)
          .leftJoin(people, eq(people.id, trainingRecords.personId))
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(where)
          .orderBy(desc(trainingRecords.completedOn))
          .limit(limit),
        tx.select({ c: count() }).from(trainingRecords).where(where),
      ])
      const total = Number(totalRow[0]?.c ?? 0)
      return {
        ok: true,
        data: {
          total,
          returned: rows.length,
          truncated: total > rows.length,
          items: rows.map((r) => ({
            id: r.id,
            person: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || null,
            course: r.course,
            completedOn: r.completedOn,
            expiresOn: r.expiresOn,
            grade: r.grade,
          })),
        },
      }
    })
  },
}

const listMyOpenItems: AssistantToolDef = {
  name: 'list_my_open_items',
  description:
    "Summarize what's on the current user's plate right now: their open corrective actions and their own training that's expiring soon. Read-only.",
  category: 'read',
  gate: { mode: 'public' },
  inputSchema: z.object({}),
  execute: async (_args, ctx): Promise<ToolResult> => {
    return ctx.db(async (tx) => {
      const membershipId = ctx.membership?.id ?? null
      const [me] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.userId, ctx.userId))
        .limit(1)
      const myPersonId = me?.id ?? null

      const myCas = membershipId
        ? await tx
            .select({
              id: correctiveActions.id,
              reference: correctiveActions.reference,
              title: correctiveActions.title,
              status: correctiveActions.status,
              dueOn: correctiveActions.dueOn,
            })
            .from(correctiveActions)
            .where(
              and(
                isNull(correctiveActions.deletedAt),
                eq(correctiveActions.ownerTenantUserId, membershipId),
                inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
              ),
            )
            .orderBy(correctiveActions.dueOn)
            .limit(25)
        : []

      const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
      const expiringTraining = myPersonId
        ? await tx
            .select({
              id: trainingRecords.id,
              course: trainingCourses.name,
              expiresOn: trainingRecords.expiresOn,
            })
            .from(trainingRecords)
            .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
            .where(
              and(
                isNull(trainingRecords.deletedAt),
                eq(trainingRecords.personId, myPersonId),
                lt(trainingRecords.expiresOn, horizon),
                latestTrainingRecordOnly(),
              ),
            )
            .orderBy(trainingRecords.expiresOn)
            .limit(25)
        : []

      return {
        ok: true,
        data: {
          openCorrectiveActions: myCas,
          trainingExpiringSoon: expiringTraining,
          note:
            myPersonId === null
              ? 'No linked person profile, so personal training could not be resolved.'
              : undefined,
        },
      }
    })
  },
}

// ---- user guide (the built-in manual at /help) ------------------------------
// Pure code content (lib/manual), no DB. Both tools filter to articles the
// current user could open at /help, so "how do I…" answers never describe
// features the user can't see.

const searchUserGuide: AssistantToolDef = {
  name: 'search_user_guide',
  description:
    'Search the built-in BeaconHS user guide (plain-language how-to articles about USING THE APP: reporting incidents, filling hazard assessments, vehicle logs, training, admin, etc.). Use this whenever the user asks how to do something in the app. Returns matching articles with excerpts. Read-only.',
  category: 'read',
  gate: { mode: 'public' },
  inputSchema: z.object({
    query: z.string().min(1).max(120),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { query: string }
    const hits = searchManualArticles(ctx, a.query).slice(0, 8)
    return {
      ok: true,
      data: {
        total: hits.length,
        items: hits.map(({ article, excerpt }) => ({
          slug: article.slug,
          title: article.title,
          group: article.group,
          summary: article.summary,
          excerpt: excerpt || undefined,
          url: `/help/${article.slug}`,
        })),
      },
    }
  },
}

const readUserGuide: AssistantToolDef = {
  name: 'read_user_guide',
  description:
    'Read one article from the built-in BeaconHS user guide by slug (find slugs with search_user_guide). Returns the full plain-language article as markdown. Read-only.',
  category: 'read',
  gate: { mode: 'public' },
  inputSchema: z.object({
    slug: z.string().min(1).max(80),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { slug: string }
    const article = manualArticleForUser(ctx, a.slug)
    if (!article) return { ok: false, error: 'article_not_found' }
    return {
      ok: true,
      data: {
        slug: article.slug,
        title: article.title,
        group: article.group,
        summary: article.summary,
        url: `/help/${article.slug}`,
        body: article.body,
      },
    }
  },
}

/** The read/search catalog. Write/draft tools are added in tools-write.ts. */
export const READ_TOOLS: AssistantToolDef[] = [
  whoami,
  findIncidents,
  getIncident,
  findCorrectiveActions,
  getCorrectiveAction,
  findDocuments,
  searchDocument,
  readDocument,
  viewDocumentPages,
  findPeople,
  findTrainingRecords,
  listMyOpenItems,
  searchUserGuide,
  readUserGuide,
]
