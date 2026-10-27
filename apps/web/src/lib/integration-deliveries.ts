// Delivery history for outbound automations, merged from the two ledgers:
// integration_export_log (what a destination actually did) and
// domain_event_outbox (what was published). An event can be "published"
// while its delivery failed or never landed, so neither table alone tells
// the truth — these helpers present one row per (automation, subject) with
// the delivery outcome. Failed and never-delivered rows are re-sendable.

import { sql } from 'drizzle-orm'
import { extractRows } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'

export type IntegrationDeliveryStatus = 'delivered' | 'failed' | 'not_delivered'

export interface IntegrationDelivery {
  automationId: string
  automationName: string | null
  triggerKey: string
  subjectId: string
  status: IntegrationDeliveryStatus
  lastAttemptAt: Date | null
  error: string | null
  refCount: number
}

interface DeliverySqlRow {
  automation_id: string
  automation_name: string | null
  trigger_key: string
  subject_id: string
  delivered: boolean
  has_log: boolean
  last_attempt_at: Date | string | null
  error: string | null
  ref_count: number | string
}

function toDelivery(row: DeliverySqlRow): IntegrationDelivery {
  return {
    automationId: row.automation_id,
    automationName: row.automation_name,
    triggerKey: row.trigger_key,
    subjectId: row.subject_id,
    status: row.delivered ? 'delivered' : row.has_log ? 'failed' : 'not_delivered',
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    error: row.delivered ? null : row.error,
    refCount: Number(row.ref_count),
  }
}

/** Every subject an automation has delivered (or should have delivered). */
export async function deliveriesForAutomation(
  ctx: RequestContext,
  automation: { id: string; name: string | null; triggerKey: string | null },
): Promise<IntegrationDelivery[]> {
  if (!automation.triggerKey) return []
  const rows = await ctx.db(async (tx) => {
    const result = await tx.execute(sql`
      WITH logs AS (
        SELECT
          subject_id,
          subject_type,
          bool_and(status = 'pushed') AS delivered,
          max(created_at) AS last_attempt_at,
          (array_agg(detail ORDER BY created_at DESC))[1]->>'error' AS error,
          count(*) FILTER (WHERE external_ref IS NOT NULL) AS ref_count
        FROM integration_export_log
        WHERE tenant_id = ${ctx.tenantId} AND automation_id = ${automation.id}
        GROUP BY subject_id, subject_type
      ),
      pending AS (
        SELECT
          o.subject_id,
          o.event_type AS subject_type,
          max(o.integration_published_at) AS last_attempt_at
        FROM domain_event_outbox o
        WHERE o.tenant_id = ${ctx.tenantId}
          AND o.event_type = ${automation.triggerKey}
          AND o.integration_published_at IS NOT NULL
          AND o.payload ? 'integration'
          AND NOT EXISTS (
            SELECT 1 FROM logs l
            WHERE l.subject_id = o.subject_id AND l.subject_type = o.event_type
          )
        GROUP BY o.subject_id, o.event_type
      )
      SELECT
        ${automation.id}::text AS automation_id,
        ${automation.name} AS automation_name,
        subject_type AS trigger_key,
        subject_id::text AS subject_id,
        delivered,
        true AS has_log,
        last_attempt_at,
        error,
        ref_count
      FROM logs
      UNION ALL
      SELECT
        ${automation.id}::text,
        ${automation.name},
        subject_type,
        subject_id::text,
        false,
        false,
        last_attempt_at,
        NULL,
        0
      FROM pending
      ORDER BY last_attempt_at DESC NULLS LAST
    `)
    return extractRows(result) as unknown as DeliverySqlRow[]
  })
  return rows.map(toDelivery)
}

/** Every automation delivery for one subject (e.g. one training class). */
export async function deliveriesForSubject(
  ctx: RequestContext,
  triggerKey: string,
  subjectId: string,
): Promise<IntegrationDelivery[]> {
  const rows = await ctx.db(async (tx) => {
    const result = await tx.execute(sql`
      WITH logs AS (
        SELECT
          automation_id,
          bool_and(status = 'pushed') AS delivered,
          max(created_at) AS last_attempt_at,
          (array_agg(detail ORDER BY created_at DESC))[1]->>'error' AS error,
          count(*) FILTER (WHERE external_ref IS NOT NULL) AS ref_count
        FROM integration_export_log
        WHERE tenant_id = ${ctx.tenantId}
          AND subject_type = ${triggerKey}
          AND subject_id = ${subjectId}
        GROUP BY automation_id
      ),
      published AS (
        SELECT max(integration_published_at) AS at
        FROM domain_event_outbox
        WHERE tenant_id = ${ctx.tenantId}
          AND event_type = ${triggerKey}
          AND subject_id = ${subjectId}
          AND integration_published_at IS NOT NULL
          AND payload ? 'integration'
      )
      SELECT
        ti.id::text AS automation_id,
        ti.name AS automation_name,
        ${triggerKey} AS trigger_key,
        ${subjectId}::text AS subject_id,
        coalesce(l.delivered, false) AS delivered,
        l.automation_id IS NOT NULL AS has_log,
        coalesce(l.last_attempt_at, p.at) AS last_attempt_at,
        coalesce(l.error, ti.last_error) AS error,
        coalesce(l.ref_count, 0) AS ref_count
      FROM tenant_integrations ti
      CROSS JOIN published p
      LEFT JOIN logs l ON l.automation_id = ti.id
      WHERE ti.tenant_id = ${ctx.tenantId}
        AND ti.trigger_key = ${triggerKey}
        AND ti.deleted_at IS NULL
        AND p.at IS NOT NULL
        AND (ti.enabled OR l.automation_id IS NOT NULL)
      ORDER BY last_attempt_at DESC NULLS LAST
    `)
    return extractRows(result) as unknown as DeliverySqlRow[]
  })
  return rows.map(toDelivery)
}
