import { searchableRecordWhere } from '@/lib/active-record-query'
import { recordSearchWhere } from '@/lib/record-search'
// Global search across the major entity types reachable from the top-bar
// search box. Each entity contributes its own SQL with a hard LIMIT 5; we then
// join the counts so the UI can show "View all incidents matching X".
//
// All queries are tenant-scoped via `ctx.db()` which sets the RLS GUC, and each
// record module additionally applies the caller's read tier (`moduleScopeWhere`)
// so search never surfaces records whose list/detail pages would hide them.
// Nothing here mutates state — purely a GET endpoint.

import { NextResponse } from 'next/server'
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm'
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

    // Reuse each predicate for results and totals so excluded records cannot
    // inflate a group's count or leak through a different search branch.
    const incidentWhere = and(
      searchableRecordWhere('incidents'),
      incidentVis,
      recordSearchWhere('incidents', rawQ),
    )
    const caWhere = and(
      searchableRecordWhere('corrective_actions'),
      caVis,
      recordSearchWhere('corrective_actions', rawQ),
    )
    const peopleWhere = and(searchableRecordWhere('people'), recordSearchWhere('people', rawQ))
    const equipmentWhere = and(
      searchableRecordWhere('equipment'),
      equipmentVis,
      recordSearchWhere('equipment', rawQ),
    )
    const documentWhere = and(
      searchableRecordWhere('documents'),
      documentsVis,
      recordSearchWhere('documents', rawQ),
    )
    const hazidWhere = and(
      searchableRecordWhere('hazid_assessments'),
      hazidVis,
      recordSearchWhere('hazid_assessments', rawQ),
    )

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
      // ---- incidents (reference / title / description, all history) ------
      (() => {
        return tx
          .select({
            id: incidents.id,
            reference: incidents.reference,
            title: incidents.title,
            occurredAt: incidents.occurredAt,
          })
          .from(incidents)
          .where(incidentWhere)
          .orderBy(desc(incidents.occurredAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(incidents).where(incidentWhere)
      })(),

      // ---- corrective actions (including descriptions and resolution notes) ------------------------
      (() => {
        return tx
          .select({
            id: correctiveActions.id,
            reference: correctiveActions.reference,
            title: correctiveActions.title,
            status: correctiveActions.status,
          })
          .from(correctiveActions)
          .where(caWhere)
          .orderBy(desc(correctiveActions.createdAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(correctiveActions).where(caWhere)
      })(),

      // ---- people (names / employee number / email / primary title) -----------
      (() => {
        return tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            employeeNo: people.employeeNo,
            jobTitle: primaryPersonTitleName(people.id, people.tenantId),
          })
          .from(people)
          .where(peopleWhere)
          .orderBy(people.lastName, people.firstName)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(people).where(peopleWhere)
      })(),

      // ---- equipment_items (identifiers / descriptions / related classifications) -------------
      (() => {
        return tx
          .select({
            id: equipmentItems.id,
            assetTag: equipmentItems.assetTag,
            name: equipmentItems.name,
            serialNumber: equipmentItems.serialNumber,
            licensePlate: equipmentItems.licensePlate,
            status: equipmentItems.status,
          })
          .from(equipmentItems)
          .where(equipmentWhere)
          .orderBy(equipmentItems.assetTag)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(equipmentItems).where(equipmentWhere)
      })(),

      // ---- documents (title / key / description) -------------------------------------
      (() => {
        return tx
          .select({
            id: documents.id,
            title: documents.title,
            key: documents.key,
            category: documentCategories.name,
          })
          .from(documents)
          .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
          .where(documentWhere)
          .orderBy(documents.title)
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(documents).where(documentWhere)
      })(),

      // ---- hazid_assessments (reference / location / job scope) -------------------------------
      (() => {
        return tx
          .select({
            id: hazidAssessments.id,
            reference: hazidAssessments.reference,
            occurredAt: hazidAssessments.occurredAt,
            jobScope: hazidAssessments.jobScope,
          })
          .from(hazidAssessments)
          .where(hazidWhere)
          .orderBy(desc(hazidAssessments.occurredAt))
          .limit(PER_GROUP_LIMIT)
      })(),
      (() => {
        return tx.select({ c: count() }).from(hazidAssessments).where(hazidWhere)
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
        sublabel: r.occurredAt
          ? formatDate(new Date(r.occurredAt), ctx.timezone, ctx.locale)
          : undefined,
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
        sublabel:
          [r.licensePlate, r.serialNumber ? `S/N ${r.serialNumber}` : null]
            .filter(Boolean)
            .join(' · ') || r.status,
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
        href:
          can(ctx, 'documents.manage') || ctx.isSuperAdmin
            ? `/documents/${r.id}`
            : `/documents/${r.id}/read`,
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
          (r.occurredAt ? formatDate(new Date(r.occurredAt), ctx.timezone, ctx.locale) : undefined),
        href: `/hazard-assessments/${r.id}`,
      })),
    })
  }
  return NextResponse.json<SearchResponse>({ q: rawQ, groups })
}
