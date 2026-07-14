// Global search across the major entity types reachable from the top-bar
// search box. Each entity contributes its own SQL with a hard LIMIT 5; we then
// join the counts so the UI can show "View all incidents matching X".
//
// All queries are tenant-scoped via `ctx.db()` which sets the RLS GUC, and each
// record module additionally applies the caller's read tier (`moduleScopeWhere`)
// so search never surfaces records whose list/detail pages would hide them.
// Nothing here mutates state — purely a GET endpoint.

import { NextResponse } from 'next/server'
import { and, count, desc, eq, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { primaryPersonTitleName } from '@beaconhs/db'
import {
  correctiveActions,
  documentCategories,
  documents,
  equipmentItems,
  hazidAssessments,
  incidents,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { getRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { documentReadFilter } from '@/lib/assistant/doc-access'

export const dynamic = 'force-dynamic'

export type SearchResultItem = {
  id: string
  label: string
  sublabel?: string
  href: string
}

export type SearchGroup = {
  type:
    'incidents' | 'corrective_actions' | 'people' | 'equipment' | 'documents' | 'hazid_assessments'
  total: number
  items: SearchResultItem[]
}

export type SearchResponse = {
  q: string
  groups: SearchGroup[]
}

const PER_GROUP_LIMIT = 5
const MAX_QUERY_LEN = 100

function escapeIlike(q: string): string {
  // postgres ILIKE treats _ and % as wildcards; escape so the user's typed
  // value matches as a substring.
  return q.replace(/[%_\\]/g, (m) => `\\${m}`)
}

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = await getRequestContext()
  if (!ctx) {
    return NextResponse.json<SearchResponse>({ q: '', groups: [] }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawQ = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LEN)
  if (rawQ.length < 2) {
    return NextResponse.json<SearchResponse>({ q: rawQ, groups: [] })
  }

  const escaped = escapeIlike(rawQ)
  const term = `%${escaped}%`

  // "Last year" cutoff applied only to high-volume entities (incidents). The
  // detail pages still allow searching deeper via the per-entity list.
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const data = await ctx.db(async (tx) => {
    // Per-user record visibility, mirroring each module's list page: read.all →
    // everything, read.site → the caller's sites, else → only their own records.
    const [incidentVis, caVis, equipmentVis, hazidVis] = await Promise.all([
      moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
      }),
      moduleScopeWhere(ctx, tx, {
        prefix: 'ca',
        ownerCols: [correctiveActions.ownerTenantUserId],
        siteCol: correctiveActions.siteOrgUnitId,
      }),
      moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentItems.currentHolderPersonId,
      }),
      moduleScopeWhere(ctx, tx, {
        prefix: 'hazid',
        ownerCols: [hazidAssessments.reportedByTenantUserId],
        siteCol: hazidAssessments.siteOrgUnitId,
      }),
    ])
    // Documents has a flat read permission instead of tiers — the /documents
    // page 404s without it, so search must skip the group entirely.
    const canReadDocuments = can(ctx, 'documents.read') || can(ctx, 'documents.manage')
    const documentsVis: SQL<unknown> | undefined = canReadDocuments
      ? documentReadFilter(ctx)
      : sql`false`

    const [
      incidentRows,
      incidentTotal,
      caRows,
      caTotal,
      peopleRows,
      peopleTotal,
      equipmentRows,
      equipmentTotal,
      documentRows,
      documentTotal,
      hazidRows,
      hazidTotal,
    ] = await Promise.all([
      // ---- incidents (reference / title / description, last 1 year) ------
      (() => {
        const where: SQL<unknown>[] = [
          gte(incidents.occurredAt, oneYearAgo),
          isNull(incidents.deletedAt),
        ]
        if (incidentVis) where.push(incidentVis)
        const match = or(
          ilike(incidents.reference, term),
          ilike(incidents.title, term),
          ilike(incidents.description, term),
        )
        if (match) where.push(match)
        return tx
          .select({
            id: incidents.id,
            reference: incidents.reference,
            title: incidents.title,
            occurredAt: incidents.occurredAt,
          })
          .from(incidents)
          .where(and(...where))
          .orderBy(desc(incidents.occurredAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [
          gte(incidents.occurredAt, oneYearAgo),
          isNull(incidents.deletedAt),
        ]
        if (incidentVis) where.push(incidentVis)
        const match = or(
          ilike(incidents.reference, term),
          ilike(incidents.title, term),
          ilike(incidents.description, term),
        )
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(incidents)
          .where(and(...where))
      })(),

      // ---- corrective actions (reference + title) ------------------------
      (() => {
        const where: SQL<unknown>[] = [isNull(correctiveActions.deletedAt)]
        if (caVis) where.push(caVis)
        const match = or(
          ilike(correctiveActions.reference, term),
          ilike(correctiveActions.title, term),
        )
        if (match) where.push(match)
        return tx
          .select({
            id: correctiveActions.id,
            reference: correctiveActions.reference,
            title: correctiveActions.title,
            status: correctiveActions.status,
          })
          .from(correctiveActions)
          .where(and(...where))
          .orderBy(desc(correctiveActions.createdAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [isNull(correctiveActions.deletedAt)]
        if (caVis) where.push(caVis)
        const match = or(
          ilike(correctiveActions.reference, term),
          ilike(correctiveActions.title, term),
        )
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(correctiveActions)
          .where(and(...where))
      })(),

      // ---- people (firstName / lastName / employeeNo / email) -----------
      (() => {
        const where: SQL<unknown>[] = [isNull(people.deletedAt)]
        const match = or(
          ilike(people.firstName, term),
          ilike(people.lastName, term),
          ilike(people.employeeNo, term),
          ilike(people.email, term),
          // Match "firstName lastName" so "john smith" finds the row even
          // though neither column on its own contains the space.
          ilike(sql<string>`(${people.firstName} || ' ' || ${people.lastName})`, term),
        )
        if (match) where.push(match)
        return tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            employeeNo: people.employeeNo,
            jobTitle: primaryPersonTitleName(people.id, people.tenantId),
          })
          .from(people)
          .where(and(...where))
          .orderBy(people.lastName, people.firstName)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [isNull(people.deletedAt)]
        const match = or(
          ilike(people.firstName, term),
          ilike(people.lastName, term),
          ilike(people.employeeNo, term),
          ilike(people.email, term),
          ilike(sql<string>`(${people.firstName} || ' ' || ${people.lastName})`, term),
        )
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(people)
          .where(and(...where))
      })(),

      // ---- equipment_items (assetTag / serialNumber / name) -------------
      (() => {
        const where: SQL<unknown>[] = [isNull(equipmentItems.deletedAt)]
        if (equipmentVis) where.push(equipmentVis)
        const match = or(
          ilike(equipmentItems.assetTag, term),
          ilike(equipmentItems.serialNumber, term),
          ilike(equipmentItems.name, term),
        )
        if (match) where.push(match)
        return tx
          .select({
            id: equipmentItems.id,
            assetTag: equipmentItems.assetTag,
            name: equipmentItems.name,
            serialNumber: equipmentItems.serialNumber,
            status: equipmentItems.status,
          })
          .from(equipmentItems)
          .where(and(...where))
          .orderBy(equipmentItems.assetTag)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [isNull(equipmentItems.deletedAt)]
        if (equipmentVis) where.push(equipmentVis)
        const match = or(
          ilike(equipmentItems.assetTag, term),
          ilike(equipmentItems.serialNumber, term),
          ilike(equipmentItems.name, term),
        )
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(equipmentItems)
          .where(and(...where))
      })(),

      // ---- documents (title + key) -------------------------------------
      (() => {
        const where: SQL<unknown>[] = [isNull(documents.deletedAt)]
        if (documentsVis) where.push(documentsVis)
        const match = or(ilike(documents.title, term), ilike(documents.key, term))
        if (match) where.push(match)
        return tx
          .select({
            id: documents.id,
            title: documents.title,
            key: documents.key,
            category: documentCategories.name,
          })
          .from(documents)
          .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
          .where(and(...where))
          .orderBy(documents.title)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [isNull(documents.deletedAt)]
        if (documentsVis) where.push(documentsVis)
        const match = or(ilike(documents.title, term), ilike(documents.key, term))
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(documents)
          .where(and(...where))
      })(),

      // ---- hazid_assessments (reference) -------------------------------
      (() => {
        const where: SQL<unknown>[] = [isNull(hazidAssessments.deletedAt)]
        if (hazidVis) where.push(hazidVis)
        const match = ilike(hazidAssessments.reference, term)
        if (match) where.push(match)
        return tx
          .select({
            id: hazidAssessments.id,
            reference: hazidAssessments.reference,
            occurredAt: hazidAssessments.occurredAt,
            jobScope: hazidAssessments.jobScope,
          })
          .from(hazidAssessments)
          .where(and(...where))
          .orderBy(desc(hazidAssessments.occurredAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        const where: SQL<unknown>[] = [isNull(hazidAssessments.deletedAt)]
        if (hazidVis) where.push(hazidVis)
        const match = ilike(hazidAssessments.reference, term)
        if (match) where.push(match)
        return tx
          .select({ c: count() })
          .from(hazidAssessments)
          .where(and(...where))
      })(),
    ])

    return {
      incidentRows,
      incidentTotal: Number(incidentTotal[0]?.c ?? 0),
      caRows,
      caTotal: Number(caTotal[0]?.c ?? 0),
      peopleRows,
      peopleTotal: Number(peopleTotal[0]?.c ?? 0),
      equipmentRows,
      equipmentTotal: Number(equipmentTotal[0]?.c ?? 0),
      documentRows,
      documentTotal: Number(documentTotal[0]?.c ?? 0),
      hazidRows,
      hazidTotal: Number(hazidTotal[0]?.c ?? 0),
    }
  })

  const groups: SearchGroup[] = []

  if (data.incidentTotal > 0) {
    groups.push({
      type: 'incidents',
      total: data.incidentTotal,
      items: data.incidentRows.map((r) => ({
        id: r.id,
        label: `${r.reference} — ${r.title}`,
        sublabel: r.occurredAt ? formatDate(new Date(r.occurredAt), ctx.timezone) : undefined,
        href: `/incidents/${r.id}`,
      })),
    })
  }
  if (data.caTotal > 0) {
    groups.push({
      type: 'corrective_actions',
      total: data.caTotal,
      items: data.caRows.map((r) => ({
        id: r.id,
        label: `${r.reference} — ${r.title}`,
        sublabel: r.status,
        href: `/corrective-actions/${r.id}`,
      })),
    })
  }
  if (data.peopleTotal > 0) {
    groups.push({
      type: 'people',
      total: data.peopleTotal,
      items: data.peopleRows.map((r) => ({
        id: r.id,
        label: `${r.firstName} ${r.lastName}`,
        sublabel: r.employeeNo
          ? `#${r.employeeNo}${r.jobTitle ? ` · ${r.jobTitle}` : ''}`
          : (r.jobTitle ?? undefined),
        href: `/people/${r.id}`,
      })),
    })
  }
  if (data.equipmentTotal > 0) {
    groups.push({
      type: 'equipment',
      total: data.equipmentTotal,
      items: data.equipmentRows.map((r) => ({
        id: r.id,
        label: `${r.assetTag} — ${r.name}`,
        sublabel: r.serialNumber ? `S/N ${r.serialNumber}` : r.status,
        href: `/equipment/${r.id}`,
      })),
    })
  }
  if (data.documentTotal > 0) {
    groups.push({
      type: 'documents',
      total: data.documentTotal,
      items: data.documentRows.map((r) => ({
        id: r.id,
        label: r.title,
        sublabel: r.category ? `${r.category} · ${r.key}` : r.key,
        href: `/documents/${r.id}`,
      })),
    })
  }
  if (data.hazidTotal > 0) {
    groups.push({
      type: 'hazid_assessments',
      total: data.hazidTotal,
      items: data.hazidRows.map((r) => ({
        id: r.id,
        label: r.reference,
        sublabel:
          htmlToSnippet(r.jobScope, 100) ||
          (r.occurredAt ? formatDate(new Date(r.occurredAt), ctx.timezone) : undefined),
        href: `/hazard-assessments/${r.id}`,
      })),
    })
  }
  return NextResponse.json<SearchResponse>({ q: rawQ, groups })
}
