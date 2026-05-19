// Server-side checks for the data-quality analyzer page. Each check runs
// against the current tenant via the RLS-scoped context, returns a count + a
// representative sample (id, label) for "show me the affected rows", and a
// deep link to a list page filtered down to the bad rows where one exists.

import { and, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  correctiveActions,
  equipmentItems,
  incidents,
  people,
  safeDistanceRecords,
  toolboxJournals,
} from '@beaconhs/db/schema'

export type Finding = {
  key: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
  count: number
  sampleHref: string | null
  samples: { id: string; label: string }[]
}

export async function runAnalyzer(ctx: RequestContext): Promise<Finding[]> {
  return ctx.db(async (tx) => {
    const findings: Finding[] = []

    // ---- People with no department ----
    const noDept = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(
        and(
          eq(people.status, 'active'),
          isNull(people.departmentId),
          isNull(people.deletedAt),
        ),
      )
      .limit(2000)
    findings.push({
      key: 'people-no-dept',
      title: 'Active people without a department',
      description:
        'Reports group people by department. Anyone without one falls off the bucket roll-ups.',
      severity: 'medium',
      count: noDept.length,
      sampleHref: '/people?department=',
      samples: noDept.slice(0, 10).map((p) => ({
        id: p.id,
        label:
          `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() ||
          '(unnamed)',
      })),
    })

    // ---- People with no trade ----
    const noTrade = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(
        and(
          eq(people.status, 'active'),
          isNull(people.tradeId),
          isNull(people.deletedAt),
        ),
      )
      .limit(2000)
    findings.push({
      key: 'people-no-trade',
      title: 'Active people without a trade',
      description:
        'Audience-by-trade assignments will skip these people. Set a trade on each person.',
      severity: 'low',
      count: noTrade.length,
      sampleHref: '/people',
      samples: noTrade.slice(0, 10).map((p) => ({
        id: p.id,
        label:
          `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() ||
          '(unnamed)',
      })),
    })

    // ---- Equipment without a type ----
    const noType = await tx
      .select({ id: equipmentItems.id, name: equipmentItems.name })
      .from(equipmentItems)
      .where(and(isNull(equipmentItems.typeId), isNull(equipmentItems.deletedAt)))
      .limit(2000)
    findings.push({
      key: 'equipment-no-type',
      title: 'Equipment items without a type',
      description:
        'Inspection assignments target equipment by type. Untyped items never get inspections.',
      severity: 'medium',
      count: noType.length,
      sampleHref: '/equipment',
      samples: noType.slice(0, 10).map((e) => ({
        id: e.id,
        label: e.name ?? '(unnamed)',
      })),
    })

    // ---- CAs with no source ----
    const caNoSource = await tx
      .select({
        id: correctiveActions.id,
        reference: correctiveActions.reference,
        title: correctiveActions.title,
      })
      .from(correctiveActions)
      .where(
        and(
          isNull(correctiveActions.source),
          isNull(correctiveActions.deletedAt),
        ),
      )
      .limit(2000)
    findings.push({
      key: 'ca-no-source',
      title: 'Corrective actions with no source category',
      description:
        'The reports break CAs down by source (incident, inspection, audit, JSHA, other). Unspecified CAs sit outside the rollup.',
      severity: 'low',
      count: caNoSource.length,
      sampleHref: '/corrective-actions',
      samples: caNoSource.slice(0, 10).map((c) => ({
        id: c.id,
        label: `${c.reference} — ${c.title}`,
      })),
    })

    // ---- Incidents missing optional-but-important fields ----
    // The columns enforced by the schema (severity, occurredAt, title) are
    // NOT NULL so we audit the optional context fields that the reports lean
    // on instead: description, location, and the classification taxonomy.
    const incidentMissing = await tx
      .select({
        id: incidents.id,
        reference: incidents.reference,
        title: incidents.title,
      })
      .from(incidents)
      .where(
        and(
          isNull(incidents.deletedAt),
          or(
            isNull(incidents.description),
            isNull(incidents.location),
            sql`coalesce(${incidents.classification}, '{}') = '{}'::jsonb`,
            isNull(incidents.siteOrgUnitId),
          ) as SQL<unknown>,
        ),
      )
      .limit(2000)
    findings.push({
      key: 'incident-missing-context',
      title: 'Incidents missing description, location, classification, or site',
      description:
        'Incidents need a description, location, classification, and site to drive trend reports. Anything missing here distorts the breakdowns.',
      severity: 'high',
      count: incidentMissing.length,
      sampleHref: '/incidents',
      samples: incidentMissing.slice(0, 10).map((i) => ({
        id: i.id,
        label: `${i.reference ?? '(no-ref)'} — ${i.title ?? '(no title)'}`,
      })),
    })

    // ---- Toolbox journals with no foreman/site ----
    const tbxOrphans = await tx
      .select({
        id: toolboxJournals.id,
        reference: toolboxJournals.reference,
        title: toolboxJournals.title,
      })
      .from(toolboxJournals)
      .where(
        and(
          isNull(toolboxJournals.deletedAt),
          or(
            isNull(toolboxJournals.foremanTenantUserId),
            isNull(toolboxJournals.siteOrgUnitId),
          ) as SQL<unknown>,
        ),
      )
      .limit(2000)
    findings.push({
      key: 'toolbox-orphans',
      title: 'Toolbox journals missing foreman or site',
      description:
        'Compliance rollups group by foreman and site. Journals without either drop out of those breakdowns.',
      severity: 'low',
      count: tbxOrphans.length,
      sampleHref: '/toolbox',
      samples: tbxOrphans.slice(0, 10).map((t) => ({
        id: t.id,
        label: `${t.reference} — ${t.title}`,
      })),
    })

    // ---- Safe-distance records flagged non-compliant + not yet linked to a CA ----
    const sdOpen = await tx
      .select({
        id: safeDistanceRecords.id,
        reference: safeDistanceRecords.reference,
        sourceDescription: safeDistanceRecords.sourceDescription,
      })
      .from(safeDistanceRecords)
      .where(
        and(
          eq(safeDistanceRecords.complies, false),
          eq(safeDistanceRecords.locked, false),
          isNull(safeDistanceRecords.deletedAt),
        ),
      )
      .limit(2000)
    findings.push({
      key: 'sd-noncompliant-open',
      title: 'Non-compliant safe-distance records still unlocked',
      description:
        'Each non-compliant assessment should drive a follow-up (engineering review or CA) before the record is locked.',
      severity: 'medium',
      count: sdOpen.length,
      sampleHref: '/tools/safe-distance?complies=no',
      samples: sdOpen.slice(0, 10).map((s) => ({
        id: s.id,
        label: `${s.reference} — ${s.sourceDescription ?? ''}`,
      })),
    })

    // ---- Totals at the top of the page need a quick count of each table ----
    const [tablePeople] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
    const [tableEquipment] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(isNull(equipmentItems.deletedAt))
    const [tableCAs] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(isNull(correctiveActions.deletedAt))
    const [tableIncidents] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(isNull(incidents.deletedAt))
    // The totals don't go into findings — we expose them via a parallel
    // function for the page header summary strip.
    return findings.sort((a, b) =>
      severityRank(b.severity) - severityRank(a.severity) || b.count - a.count,
    )
  })
}

function severityRank(s: 'low' | 'medium' | 'high'): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1
}

export async function getTenantTableTotals(
  ctx: RequestContext,
): Promise<{ people: number; equipment: number; correctiveActions: number; incidents: number }> {
  return ctx.db(async (tx) => {
    const [p] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
    const [e] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(isNull(equipmentItems.deletedAt))
    const [c] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(isNull(correctiveActions.deletedAt))
    const [i] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(isNull(incidents.deletedAt))
    return {
      people: Number(p?.c ?? 0),
      equipment: Number(e?.c ?? 0),
      correctiveActions: Number(c?.c ?? 0),
      incidents: Number(i?.c ?? 0),
    }
  })
}
