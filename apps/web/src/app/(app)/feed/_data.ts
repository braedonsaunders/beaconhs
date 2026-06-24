// Activity-feed aggregator. Pulls recent events from several modules, each
// query independently scoped to what the caller is allowed to see, normalises
// them to FeedEvent, merges by time, and cursor-paginates.
//
// VISIBILITY: incidents / CAs / forms have no server-side row-scope helper of
// their own (they lean on tenant RLS), but their permission catalogue defines
// .all/.site/.self tiers. Because the feed surfaces these prominently, we apply
// a conservative scope mirroring journals — all → tenant-wide, site → your
// sites, self → only yours, none → the source is excluded entirely. This never
// shows more than the caller's permission tier implies.

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  attachments,
  correctiveActions,
  formResponses,
  formTemplates,
  hazidAssessmentTypes,
  hazidAssessments,
  incidents,
  journalEntries,
  journalEntryPhotos,
  journalTags,
  orgUnits,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import type { Database } from '@beaconhs/db'
import { can, type RequestContext } from '@beaconhs/tenant'
import { getAuthorPersonId, htmlToText, journalScopeWhere, snippetOf } from '../journals/_lib'
import type { FeedEvent, FeedKind, FeedPage, FeedSummary, FeedTag } from './_types'

const PAGE = 20

type ModuleScope = SQL | undefined | 'none'

/** Conservative per-module visibility: all → site → self → none (mirrors journals). */
function moduleScope(
  ctx: RequestContext,
  base: string,
  siteCol: AnyPgColumn,
  actorCol: AnyPgColumn,
): ModuleScope {
  if (can(ctx, `${base}.all`)) return undefined
  if (can(ctx, `${base}.site`)) {
    const siteIds = ctx.scopes.flatMap((s) => (s.type === 'sites' ? s.siteIds : []))
    return siteIds.length ? inArray(siteCol, siteIds) : sql`false`
  }
  if (can(ctx, `${base}.self`)) {
    return ctx.membership?.id ? eq(actorCol, ctx.membership.id) : sql`false`
  }
  return 'none'
}

function whereAll(...parts: (SQL | undefined)[]): SQL | undefined {
  const xs = parts.filter((p): p is SQL => !!p)
  return xs.length ? and(...xs) : undefined
}

const STATUS_LABEL: Record<string, string> = {
  reported: 'Reported',
  under_investigation: 'Investigating',
  pending_review: 'Pending review',
  closed: 'Closed',
  reopened: 'Reopened',
  open: 'Open',
  in_progress: 'In progress',
  pending_verification: 'Verifying',
  cancelled: 'Cancelled',
  submitted: 'Submitted',
  in_review: 'In review',
  rejected: 'Rejected',
  non_compliant: 'Non-compliant',
}
const label = (s: string) => STATUS_LABEL[s] ?? s

export async function getFeed(
  ctx: RequestContext,
  opts: { cursor?: string | null; limit?: number; kinds?: FeedKind[] } = {},
): Promise<FeedPage> {
  const limit = Math.min(opts.limit ?? PAGE, 50)
  const cursor = opts.cursor ? new Date(opts.cursor) : null
  const authorPersonId = await getAuthorPersonId(ctx)
  // Optional kind filter (drives the timeline's filter pills). Empty/undefined
  // means "all kinds" — otherwise only the requested sources are queried.
  const kindSet = opts.kinds && opts.kinds.length ? new Set<FeedKind>(opts.kinds) : null
  const want = (k: FeedKind) => !kindSet || kindSet.has(k)

  const events = await ctx.db(async (tx) => {
    const all: FeedEvent[] = []

    // ---- Journals (submitted) ----
    if (want('journal')) {
      // Submitted entries set submittedAt, but fall back to createdAt so seeded /
      // legacy rows (and any without a submit timestamp) still appear and sort.
      // NB: this is a raw sql() expression, so Drizzle can't infer the param type
      // for a Date cursor — compare against an explicitly-cast ISO string instead.
      const journalAt = sql<Date>`coalesce(${journalEntries.submittedAt}, ${journalEntries.createdAt})`
      const author = alias(people, 'feed_journal_author')
      const rows = await tx
        .select({
          id: journalEntries.id,
          // Select the real columns (Drizzle maps these to Date) and coalesce in
          // JS — a raw sql() expression comes back as a string, not a Date.
          submittedAt: journalEntries.submittedAt,
          createdAt: journalEntries.createdAt,
          title: journalEntries.title,
          bodyText: journalEntries.bodyText,
          summary: journalEntries.summary,
          tags: journalEntries.tagsCache,
          first: author.firstName,
          last: author.lastName,
          siteName: orgUnits.name,
        })
        .from(journalEntries)
        .leftJoin(author, eq(author.id, journalEntries.personId))
        .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
        .where(
          whereAll(
            eq(journalEntries.status, 'submitted'),
            isNull(journalEntries.deletedAt),
            journalScopeWhere(ctx, authorPersonId),
            cursor
              ? sql`coalesce(${journalEntries.submittedAt}, ${journalEntries.createdAt}) < ${cursor.toISOString()}::timestamptz`
              : undefined,
          ),
        )
        .orderBy(desc(journalAt))
        .limit(limit)

      const ids = rows.map((r) => r.id)
      const photos = await journalPhotos(tx, ids)
      const colors = ids.length ? await tagColors(tx, ctx) : new Map<string, string | null>()
      for (const r of rows) {
        const name = [r.first, r.last].filter(Boolean).join(' ').trim() || null
        const ph = photos.get(r.id)
        all.push({
          id: `journal:${r.id}`,
          kind: 'journal',
          at: (r.submittedAt ?? r.createdAt).toISOString(),
          action: 'submitted a journal',
          actorName: name,
          siteName: r.siteName ?? null,
          title: r.title || 'Daily journal',
          // body_text is usually plain, but migrated entries can hold HTML — strip it.
          snippet: r.summary || snippetOf(htmlToText(r.bodyText), 220) || null,
          badge: null,
          href: `/journals/${r.id}`,
          tags: (r.tags ?? [])
            .slice(0, 6)
            .map((t): FeedTag => ({ name: t, color: colors.get(t) ?? null })),
          photoUrls: ph?.urls ?? [],
          photoCount: ph?.count ?? 0,
        })
      }
    }

    // ---- Incidents (reported) ----
    if (want('incident')) {
      const scope = moduleScope(
        ctx,
        'incidents.read',
        incidents.siteOrgUnitId,
        incidents.reportedByTenantUserId,
      )
      if (scope !== 'none') {
        const reporter = alias(tenantUsers, 'feed_incident_reporter')
        const rows = await tx
          .select({
            id: incidents.id,
            at: incidents.createdAt,
            title: incidents.title,
            status: incidents.status,
            actor: reporter.displayName,
            siteName: orgUnits.name,
          })
          .from(incidents)
          .leftJoin(reporter, eq(reporter.id, incidents.reportedByTenantUserId))
          .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
          .where(
            whereAll(
              isNull(incidents.deletedAt),
              scope,
              cursor ? lt(incidents.createdAt, cursor) : undefined,
            ),
          )
          .orderBy(desc(incidents.createdAt))
          .limit(limit)
        for (const r of rows)
          all.push({
            id: `incident:${r.id}`,
            kind: 'incident',
            at: r.at.toISOString(),
            action: 'reported an incident',
            actorName: r.actor ?? null,
            siteName: r.siteName ?? null,
            title: r.title,
            snippet: null,
            badge: label(r.status),
            href: `/incidents/${r.id}`,
          })
      }
    }

    // ---- Corrective actions (raised) ----
    if (want('corrective_action')) {
      const scope = moduleScope(
        ctx,
        'ca.read',
        correctiveActions.siteOrgUnitId,
        correctiveActions.ownerTenantUserId,
      )
      if (scope !== 'none') {
        const owner = alias(tenantUsers, 'feed_ca_owner')
        const rows = await tx
          .select({
            id: correctiveActions.id,
            at: correctiveActions.createdAt,
            title: correctiveActions.title,
            status: correctiveActions.status,
            actor: owner.displayName,
            siteName: orgUnits.name,
          })
          .from(correctiveActions)
          .leftJoin(owner, eq(owner.id, correctiveActions.ownerTenantUserId))
          .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
          .where(
            whereAll(
              isNull(correctiveActions.deletedAt),
              scope,
              cursor ? lt(correctiveActions.createdAt, cursor) : undefined,
            ),
          )
          .orderBy(desc(correctiveActions.createdAt))
          .limit(limit)
        for (const r of rows)
          all.push({
            id: `corrective_action:${r.id}`,
            kind: 'corrective_action',
            at: r.at.toISOString(),
            action: 'raised a corrective action',
            actorName: r.actor ?? null,
            siteName: r.siteName ?? null,
            title: r.title,
            snippet: null,
            badge: label(r.status),
            href: `/corrective-actions/${r.id}`,
          })
      }
    }

    // ---- Hazard assessments (logged) ----
    // Unlike incidents / CAs / forms, hazard assessments have no
    // .read.all/.site/.self permission tier — the module (nav + list) is gated
    // by tenant RLS alone, so the whole tenant sees every assessment. The feed
    // mirrors that: tenant-wide rows, no extra row-scope. (Routing through
    // moduleScope with a non-existent base would wrongly exclude the source.)
    if (want('hazard_assessment')) {
      const reporter = alias(tenantUsers, 'feed_hazid_reporter')
      const rows = await tx
        .select({
          id: hazidAssessments.id,
          at: hazidAssessments.createdAt,
          reference: hazidAssessments.reference,
          jobScope: hazidAssessments.jobScope,
          typeName: hazidAssessmentTypes.name,
          locked: hazidAssessments.locked,
          actor: reporter.displayName,
          siteName: orgUnits.name,
        })
        .from(hazidAssessments)
        .leftJoin(reporter, eq(reporter.id, hazidAssessments.reportedByTenantUserId))
        .leftJoin(
          hazidAssessmentTypes,
          eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
        )
        .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
        .where(
          whereAll(
            isNull(hazidAssessments.deletedAt),
            cursor ? lt(hazidAssessments.createdAt, cursor) : undefined,
          ),
        )
        .orderBy(desc(hazidAssessments.createdAt))
        .limit(limit)
      for (const r of rows)
        all.push({
          id: `hazard_assessment:${r.id}`,
          kind: 'hazard_assessment',
          at: r.at.toISOString(),
          action: 'logged a hazard assessment',
          actorName: r.actor ?? null,
          siteName: r.siteName ?? null,
          title:
            (r.jobScope?.trim() ? snippetOf(r.jobScope, 120) : null) ||
            r.typeName ||
            r.reference ||
            'Hazard assessment',
          snippet: null,
          badge: r.locked ? 'Locked' : 'In progress',
          href: `/hazard-assessments/${r.id}`,
        })
    }

    // ---- Form responses (submitted) ----
    if (want('form')) {
      const scope = moduleScope(
        ctx,
        'forms.response.read',
        formResponses.siteOrgUnitId,
        formResponses.submittedBy,
      )
      if (scope !== 'none') {
        const submitter = alias(tenantUsers, 'feed_form_submitter')
        const rows = await tx
          .select({
            id: formResponses.id,
            at: formResponses.submittedAt,
            status: formResponses.status,
            template: formTemplates.name,
            actor: submitter.displayName,
            siteName: orgUnits.name,
          })
          .from(formResponses)
          .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
          .leftJoin(submitter, eq(submitter.id, formResponses.submittedBy))
          .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
          .where(
            whereAll(
              isNotNull(formResponses.submittedAt),
              isNull(formResponses.deletedAt),
              scope,
              cursor ? lt(formResponses.submittedAt, cursor) : undefined,
            ),
          )
          .orderBy(desc(formResponses.submittedAt))
          .limit(limit)
        for (const r of rows)
          all.push({
            id: `form:${r.id}`,
            kind: 'form',
            at: (r.at as Date).toISOString(),
            action: 'submitted a form',
            actorName: r.actor ?? null,
            siteName: r.siteName ?? null,
            title: r.template,
            snippet: null,
            badge: label(r.status),
            href: `/apps/responses/${r.id}`,
          })
      }
    }

    return all
  })

  // Merge: newest first, take one page. nextCursor is the last item's time —
  // each source re-queries `at < cursor` on the next request.
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const page = events.slice(0, limit)
  const nextCursor = page.length === limit ? page[page.length - 1]!.at : null
  return { events: page, nextCursor }
}

/**
 * Counts for the feed's summary rail: events per kind over the last 7 days, plus
 * a 24-hour total. Scoped per-module exactly like getFeed, so the numbers never
 * exceed what the timeline would show. Each source contributes one cheap COUNT.
 */
export async function getFeedSummary(ctx: RequestContext): Promise<FeedSummary> {
  const now = Date.now()
  const week = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const dayIso = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const authorPersonId = await getAuthorPersonId(ctx)

  return ctx.db(async (tx) => {
    const byKind: Record<FeedKind, number> = {
      journal: 0,
      incident: 0,
      corrective_action: 0,
      hazard_assessment: 0,
      form: 0,
    }
    let today = 0

    // ---- Journals (submitted) — raw coalesce, so cursor/cutoff are ISO casts. ----
    {
      const journalAt = sql`coalesce(${journalEntries.submittedAt}, ${journalEntries.createdAt})`
      const rows = await tx
        .select({
          wk: sql<number>`count(*)`,
          day: sql<number>`count(*) filter (where ${journalAt} >= ${dayIso}::timestamptz)`,
        })
        .from(journalEntries)
        .where(
          whereAll(
            eq(journalEntries.status, 'submitted'),
            isNull(journalEntries.deletedAt),
            journalScopeWhere(ctx, authorPersonId),
            sql`${journalAt} >= ${week.toISOString()}::timestamptz`,
          ),
        )
      byKind.journal = Number(rows[0]?.wk ?? 0)
      today += Number(rows[0]?.day ?? 0)
    }

    // ---- Incidents (reported) ----
    {
      const scope = moduleScope(
        ctx,
        'incidents.read',
        incidents.siteOrgUnitId,
        incidents.reportedByTenantUserId,
      )
      if (scope !== 'none') {
        const rows = await tx
          .select({
            wk: sql<number>`count(*)`,
            day: sql<number>`count(*) filter (where ${incidents.createdAt} >= ${dayIso}::timestamptz)`,
          })
          .from(incidents)
          .where(whereAll(isNull(incidents.deletedAt), scope, gte(incidents.createdAt, week)))
        byKind.incident = Number(rows[0]?.wk ?? 0)
        today += Number(rows[0]?.day ?? 0)
      }
    }

    // ---- Corrective actions (raised) ----
    {
      const scope = moduleScope(
        ctx,
        'ca.read',
        correctiveActions.siteOrgUnitId,
        correctiveActions.ownerTenantUserId,
      )
      if (scope !== 'none') {
        const rows = await tx
          .select({
            wk: sql<number>`count(*)`,
            day: sql<number>`count(*) filter (where ${correctiveActions.createdAt} >= ${dayIso}::timestamptz)`,
          })
          .from(correctiveActions)
          .where(
            whereAll(
              isNull(correctiveActions.deletedAt),
              scope,
              gte(correctiveActions.createdAt, week),
            ),
          )
        byKind.corrective_action = Number(rows[0]?.wk ?? 0)
        today += Number(rows[0]?.day ?? 0)
      }
    }

    // ---- Hazard assessments (logged) — tenant-wide (RLS-only), see getFeed. ----
    {
      const rows = await tx
        .select({
          wk: sql<number>`count(*)`,
          day: sql<number>`count(*) filter (where ${hazidAssessments.createdAt} >= ${dayIso}::timestamptz)`,
        })
        .from(hazidAssessments)
        .where(whereAll(isNull(hazidAssessments.deletedAt), gte(hazidAssessments.createdAt, week)))
      byKind.hazard_assessment = Number(rows[0]?.wk ?? 0)
      today += Number(rows[0]?.day ?? 0)
    }

    // ---- Form responses (submitted) ----
    {
      const scope = moduleScope(
        ctx,
        'forms.response.read',
        formResponses.siteOrgUnitId,
        formResponses.submittedBy,
      )
      if (scope !== 'none') {
        const rows = await tx
          .select({
            wk: sql<number>`count(*)`,
            day: sql<number>`count(*) filter (where ${formResponses.submittedAt} >= ${dayIso}::timestamptz)`,
          })
          .from(formResponses)
          .where(
            whereAll(
              isNotNull(formResponses.submittedAt),
              isNull(formResponses.deletedAt),
              scope,
              gte(formResponses.submittedAt, week),
            ),
          )
        byKind.form = Number(rows[0]?.wk ?? 0)
        today += Number(rows[0]?.day ?? 0)
      }
    }

    const total =
      byKind.journal +
      byKind.incident +
      byKind.corrective_action +
      byKind.hazard_assessment +
      byKind.form
    return { byKind, total, today }
  })
}

async function journalPhotos(
  tx: Database,
  ids: string[],
): Promise<Map<string, { urls: string[]; count: number }>> {
  const map = new Map<string, { urls: string[]; count: number }>()
  if (ids.length === 0) return map
  const rows = await tx
    .select({
      entryId: journalEntryPhotos.entryId,
      r2Key: attachments.r2Key,
    })
    .from(journalEntryPhotos)
    .innerJoin(attachments, eq(attachments.id, journalEntryPhotos.attachmentId))
    .where(inArray(journalEntryPhotos.entryId, ids))
    .orderBy(asc(journalEntryPhotos.sortOrder))
  for (const r of rows) {
    const cur = map.get(r.entryId) ?? { urls: [], count: 0 }
    cur.count++
    if (cur.urls.length < 4) {
      const u = publicUrl(r.r2Key)
      if (u) cur.urls.push(u)
    }
    map.set(r.entryId, cur)
  }
  return map
}

async function tagColors(tx: Database, ctx: RequestContext): Promise<Map<string, string | null>> {
  const rows = await tx
    .select({ name: journalTags.name, color: journalTags.color })
    .from(journalTags)
    .where(eq(journalTags.tenantId, ctx.tenantId))
  return new Map(rows.map((r) => [r.name, r.color]))
}
