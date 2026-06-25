// Read & search tools for the assistant. Every record-bearing tool applies
// `recordVisibilityWhere` so the agent only ever returns rows the current user
// could see in a properly-scoped UI — the engines are RLS-tenant-isolated but
// NOT record-visibility-scoped, so this is the load-bearing safety boundary.
//
// Row caps are deliberately small; lists report a `total` so the model can
// answer "how many" and tell the user to narrow rather than paging blindly.

import { z } from 'zod'
import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import {
  correctiveActions,
  documentDrafts,
  documentVersions,
  documents,
  incidents,
  people,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { recordVisibilityWhere } from '@/lib/visibility'
import { documentReadFilter } from './doc-access'
import { truncateText, type AssistantToolDef, type ToolResult } from './types'

// ---- helpers ---------------------------------------------------------------

function escLike(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`)
}
function like(q: string): string {
  return `%${escLike(q.slice(0, 100))}%`
}
function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
      const vis = await recordVisibilityWhere(ctx, tx, {
        siteCol: incidents.siteOrgUnitId,
        createdByCol: incidents.reportedByTenantUserId,
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
      const vis = await recordVisibilityWhere(ctx, tx, {
        siteCol: incidents.siteOrgUnitId,
        createdByCol: incidents.reportedByTenantUserId,
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
      const vis = await recordVisibilityWhere(ctx, tx, {
        siteCol: correctiveActions.siteOrgUnitId,
        createdByCol: correctiveActions.ownerTenantUserId,
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
      const vis = await recordVisibilityWhere(ctx, tx, {
        siteCol: correctiveActions.siteOrgUnitId,
        createdByCol: correctiveActions.ownerTenantUserId,
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
            category: documents.category,
            status: documents.status,
            nextReviewOn: documents.nextReviewOn,
          })
          .from(documents)
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

const readDocument: AssistantToolDef = {
  name: 'read_document',
  description:
    'Read a controlled document’s current content by id, as plain text. Prefers the latest published version, falling back to the working draft. Read-only.',
  category: 'read',
  gate: { mode: 'anyOf', perms: ['documents.read', 'documents.manage'] },
  inputSchema: z.object({ id: z.string().uuid() }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { id: string }
    return ctx.db(async (tx) => {
      const docConds: SQL[] = [eq(documents.id, a.id), isNull(documents.deletedAt)]
      const pubOnly = documentReadFilter(ctx)
      if (pubOnly) docConds.push(pubOnly)
      const [doc] = await tx
        .select({
          id: documents.id,
          key: documents.key,
          title: documents.title,
          status: documents.status,
        })
        .from(documents)
        .where(and(...docConds))
        .limit(1)
      if (!doc) return { ok: false, error: 'not_found' }
      const [pub] = await tx
        .select({ html: documentVersions.contentMarkdown })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, a.id))
        .orderBy(desc(documentVersions.version))
        .limit(1)
      let html = pub?.html ?? null
      if (!html) {
        const [draft] = await tx
          .select({ html: documentDrafts.contentHtml })
          .from(documentDrafts)
          .where(eq(documentDrafts.documentId, a.id))
          .limit(1)
        html = draft?.html ?? null
      }
      const text = truncateText(htmlToText(html), 12_000)
      return {
        ok: true,
        data: { id: doc.id, key: doc.key, title: doc.title, status: doc.status, text },
        note: text ? undefined : 'This document has no readable content yet.',
      }
    })
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
          jobTitle: people.jobTitle,
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
    'List training records the user may see, optionally for one person or expiring within N days. Includes course name and expiry. Read-only.',
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
      }
      const vis = await recordVisibilityWhere(ctx, tx, { personCol: trainingRecords.personId })
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

/** The read/search catalog. Write/draft tools are added in tools-write.ts. */
export const READ_TOOLS: AssistantToolDef[] = [
  whoami,
  findIncidents,
  getIncident,
  findCorrectiveActions,
  getCorrectiveAction,
  findDocuments,
  readDocument,
  findPeople,
  findTrainingRecords,
  listMyOpenItems,
]
