import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { primaryPersonTitleName } from '@beaconhs/db'
import { departments, journalEntries, orgUnits, people } from '@beaconhs/db/schema'
import { htmlToText } from '@beaconhs/forms-core'
import { can } from '@beaconhs/tenant'
import { journalAuthorPersonId, journalScopeWhere } from '@beaconhs/tenant/journal-scope'
import { addDays, zonedMidnight } from '../window'
import { boundedText, personName, tally, type BriefSourceDefinition } from './types'

const supervisors = alias(people, 'brief_journal_supervisors')

const paramsSchema = z.object({
  includeDrafts: z.boolean().default(true),
  includeLate: z.boolean().default(true),
  definitions: z
    .array(z.enum(['worker', 'supervisor']))
    .max(2)
    .default([]),
  siteIds: z.array(z.uuid()).max(200).default([]),
  departmentIds: z.array(z.uuid()).max(200).default([]),
  /** Limit to specific authors (API callers): people ids or employee numbers. */
  authorPersonIds: z.array(z.uuid()).max(500).default([]),
  authorEmployeeNos: z.array(z.string().trim().min(1).max(64)).max(500).default([]),
})

type JournalParams = z.infer<typeof paramsSchema>

export const journalsSource: BriefSourceDefinition<JournalParams> = {
  key: 'journals.entries',
  label: 'Journal entries',
  description:
    'Daily journals for the window, with author, job title, department, supervisor, site, and weather. Late entries written during the window for earlier days are included and marked.',
  citationPrefix: 'J',
  params: paramsSchema as z.ZodType<JournalParams>,
  defaultParams: {
    includeDrafts: true,
    includeLate: true,
    definitions: [],
    siteIds: [],
    departmentIds: [],
    authorPersonIds: [],
    authorEmployeeNos: [],
  },
  paramFields: [
    {
      key: 'includeDrafts',
      label: 'Include drafts',
      kind: 'boolean',
      help: 'Count entries that were written but not yet submitted.',
    },
    {
      key: 'includeLate',
      label: 'Include late entries',
      kind: 'boolean',
      help: 'Entries written during the window for earlier days.',
    },
    {
      key: 'definitions',
      label: 'Journal types',
      kind: 'multi',
      options: [
        { value: 'worker', label: 'Worker' },
        { value: 'supervisor', label: 'Supervisor' },
      ],
    },
  ],
  canRead: (ctx) =>
    ctx.isSuperAdmin ||
    can(ctx, 'journals.read.all') ||
    can(ctx, 'journals.read.site') ||
    can(ctx, 'journals.read.self'),

  async collect({ ctx, tx, window, params, scope, limit }) {
    const author = journalAuthorPersonId()
    const statuses: Array<'draft' | 'submitted'> = params.includeDrafts
      ? ['draft', 'submitted']
      : ['submitted']
    const inWindow = and(
      gte(journalEntries.entryDate, window.firstDay),
      sql`${journalEntries.entryDate} <= ${window.lastDay}`,
    )!
    const late = params.includeLate
      ? and(
          lt(journalEntries.entryDate, window.firstDay),
          gte(journalEntries.createdAt, window.start),
          lt(journalEntries.createdAt, window.end),
        )
      : undefined
    const departmentFilter: SQL[] = []
    if (scope.departmentId) departmentFilter.push(eq(people.departmentId, scope.departmentId))
    if (params.departmentIds.length > 0) {
      departmentFilter.push(inArray(people.departmentId, params.departmentIds))
    }
    const authorFilter: SQL[] = []
    if (params.authorPersonIds.length > 0) {
      authorFilter.push(inArray(people.id, params.authorPersonIds))
    }
    if (params.authorEmployeeNos.length > 0) {
      authorFilter.push(inArray(people.employeeNo, params.authorEmployeeNos))
    }
    const where = and(
      isNull(journalEntries.deletedAt),
      ne(journalEntries.status, 'archived'),
      inArray(journalEntries.status, statuses),
      late ? or(inWindow, late) : inWindow,
      journalScopeWhere(ctx, ctx.personId),
      params.definitions.length > 0
        ? inArray(journalEntries.definition, params.definitions)
        : undefined,
      params.siteIds.length > 0 ? inArray(journalEntries.siteOrgUnitId, params.siteIds) : undefined,
      ...departmentFilter,
      authorFilter.length > 0 ? or(...authorFilter) : undefined,
    )

    const rows = await tx
      .select({
        id: journalEntries.id,
        reference: journalEntries.reference,
        entryDate: journalEntries.entryDate,
        status: journalEntries.status,
        definition: journalEntries.definition,
        title: journalEntries.title,
        bodyText: journalEntries.bodyText,
        bodyHtml: journalEntries.bodyHtml,
        weather: journalEntries.weather,
        createdAt: journalEntries.createdAt,
        authorFirst: people.firstName,
        authorLast: people.lastName,
        authorTitle: primaryPersonTitleName(people.id, people.tenantId),
        department: departments.name,
        site: orgUnits.name,
        supervisorFirst: supervisors.firstName,
        supervisorLast: supervisors.lastName,
      })
      .from(journalEntries)
      .leftJoin(people, eq(people.id, author))
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(supervisors, eq(supervisors.id, journalEntries.supervisorPersonId))
      .where(where)
      .orderBy(
        asc(journalEntries.entryDate),
        asc(people.lastName),
        asc(people.firstName),
        asc(journalEntries.createdAt),
      )
      .limit(limit + 1)

    const kept = rows.slice(0, limit)
    const records = kept.map((row) => {
      const authorName = personName(row.authorFirst, row.authorLast)
      const isLate = row.entryDate < window.firstDay
      const body = boundedText(
        row.bodyText?.trim() ? htmlToText(row.bodyText) : htmlToText(row.bodyHtml),
      )
      const weather = row.weather
        ? [
            row.weather.conditions?.trim(),
            typeof row.weather.tempC === 'number' ? `${Math.round(row.weather.tempC)}°C` : null,
          ]
            .filter(Boolean)
            .join(', ')
        : ''
      const meta = [
        row.authorTitle ? `Job title: ${row.authorTitle}` : null,
        row.definition === 'supervisor' ? 'Supervisor journal' : null,
        personName(row.supervisorFirst, row.supervisorLast)
          ? `Supervisor: ${personName(row.supervisorFirst, row.supervisorLast)}`
          : null,
        weather ? `Weather: ${weather}` : null,
        row.status === 'draft' ? 'Status: draft (not yet submitted)' : null,
        isLate ? `Late entry: written for ${row.entryDate}` : null,
      ].filter(Boolean)
      return {
        id: row.id,
        path: `/journals/${row.id}`,
        date: row.entryDate,
        title: row.title?.trim() || `Journal ${row.reference}`,
        author: authorName,
        department: row.department ?? null,
        site: row.site ?? null,
        status: row.status === 'draft' ? 'Draft' : isLate ? 'Late' : 'Submitted',
        text: [meta.join(' · '), body].filter(Boolean).join('\n'),
      }
    })

    // Regular authors (an entry in the 14 days before the window) who wrote
    // nothing in it — a deterministic "who went quiet" signal.
    const priorStart = zonedMidnight(addDays(window.firstDay, -14), window.timezone)
    const authorsInWindow = new Set(records.map((r) => r.author).filter(Boolean) as string[])
    const prior = await tx
      .selectDistinct({ first: people.firstName, last: people.lastName })
      .from(journalEntries)
      .innerJoin(people, eq(people.id, author))
      .where(
        and(
          isNull(journalEntries.deletedAt),
          inArray(journalEntries.status, statuses),
          gte(journalEntries.createdAt, priorStart),
          lt(journalEntries.createdAt, window.start),
          journalScopeWhere(ctx, ctx.personId),
          scope.departmentId ? eq(people.departmentId, scope.departmentId) : undefined,
          params.departmentIds.length > 0
            ? inArray(people.departmentId, params.departmentIds)
            : undefined,
        ),
      )
      .limit(500)
    const quiet = prior
      .map((p) => personName(p.first, p.last))
      .filter((name): name is string => Boolean(name) && !authorsInWindow.has(name!))
      .sort()

    const drafts = records.filter((r) => r.status === 'Draft').length
    const lateCount = records.filter((r) => r.status === 'Late').length
    return {
      records,
      truncated: Math.max(0, rows.length - limit),
      facts: [
        { key: 'journals.entries', label: 'Journal entries', value: String(records.length) },
        { key: 'journals.authors', label: 'Authors', value: String(authorsInWindow.size) },
        ...(drafts > 0
          ? [{ key: 'journals.drafts', label: 'Drafts not yet submitted', value: String(drafts) }]
          : []),
        ...(lateCount > 0
          ? [{ key: 'journals.late', label: 'Late entries', value: String(lateCount) }]
          : []),
        {
          key: 'journals.departments',
          label: 'Entries by department',
          value: String(new Set(records.map((r) => r.department ?? 'Unassigned')).size),
          items: tally(records.map((r) => r.department)),
        },
        {
          key: 'journals.sites',
          label: 'Sites with entries',
          value: String(new Set(records.map((r) => r.site).filter(Boolean)).size),
          items: tally(
            records.map((r) => r.site),
            'No site',
          ),
        },
        ...(quiet.length > 0
          ? [
              {
                key: 'journals.quiet',
                label: 'Regular authors with no entry',
                value: String(quiet.length),
                items: quiet.slice(0, 50).map((name) => ({ label: name, value: '' })),
              },
            ]
          : []),
      ],
    }
  },
}
