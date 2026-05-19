'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  reportDefinitions,
  REPORT_CUSTOM_ENTITIES,
  REPORT_FILTER_OPERATORS,
  type ReportCustomQuery,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/** Build a stable, URL-safe slug for a custom definition. */
function buildSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'custom_report'
  const suffix = randomBytes(3).toString('hex')
  return `custom__${base}__${suffix}`
}

/** Coerce form input into a strongly-typed ReportCustomQuery. */
function validateCustomQuery(raw: unknown): ReportCustomQuery {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Custom query is required')
  }
  const q = raw as Record<string, unknown>
  const entity = String(q.entity ?? '')
  if (!REPORT_CUSTOM_ENTITIES.includes(entity as never)) {
    throw new Error(`Invalid entity: ${entity}`)
  }
  const columns = Array.isArray(q.columns)
    ? (q.columns as unknown[]).filter((c): c is string => typeof c === 'string')
    : []
  if (columns.length === 0) {
    throw new Error('Pick at least one column to include')
  }
  const filters = Array.isArray(q.filters)
    ? (q.filters as unknown[]).flatMap((f) => {
        if (!f || typeof f !== 'object') return []
        const o = f as Record<string, unknown>
        const col = typeof o.column === 'string' ? o.column : ''
        const op = String(o.op ?? '')
        if (!col || !REPORT_FILTER_OPERATORS.includes(op as never)) return []
        return [
          {
            column: col,
            op: op as (typeof REPORT_FILTER_OPERATORS)[number],
            value: (o.value as ReportCustomQuery['filters'] extends Array<infer X>
              ? X extends { value?: infer V }
                ? V
                : never
              : never) ?? null,
          },
        ]
      })
    : []
  const groupBy =
    typeof q.groupBy === 'string' && q.groupBy.length > 0 ? q.groupBy : null
  const sort =
    q.sort && typeof q.sort === 'object'
      ? (() => {
          const s = q.sort as Record<string, unknown>
          if (typeof s.column !== 'string' || !s.column) return null
          const dir = s.direction === 'asc' ? 'asc' : 'desc'
          return { column: s.column, direction: dir as 'asc' | 'desc' }
        })()
      : null
  const limit = Number.isFinite(Number(q.limit)) ? Math.min(Math.max(Number(q.limit), 1), 10_000) : 1000
  return { entity: entity as ReportCustomQuery['entity'], columns, filters, groupBy, sort, limit }
}

export async function createCustomDefinition(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()

  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const cloneFromIdRaw = String(formData.get('cloneFromId') ?? '').trim()
  const customQueryRaw = String(formData.get('customQuery') ?? '').trim()
  if (!name) throw new Error('Name is required')
  if (!customQueryRaw) throw new Error('Custom query payload is missing')

  let parsed: unknown
  try {
    parsed = JSON.parse(customQueryRaw)
  } catch (err) {
    throw new Error(`Invalid customQuery JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const customQuery = validateCustomQuery(parsed)

  // If cloning, copy source description/category onto the new row.
  let category: string | null = customQuery.entity
  if (cloneFromIdRaw) {
    const src = await withSuperAdmin(db, async (tx) => {
      const [d] = await tx
        .select()
        .from(reportDefinitions)
        .where(eq(reportDefinitions.id, cloneFromIdRaw))
        .limit(1)
      return d ?? null
    })
    if (src?.category) category = src.category
  }

  const slug = buildSlug(name)

  // We write through super-admin because the definitions table has no RLS —
  // tenant scoping is enforced by setting tenantId on insert.
  const newId = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .insert(reportDefinitions)
      .values({
        tenantId: ctx.tenantId,
        kind: 'custom',
        slug,
        name,
        description,
        category,
        queryKind: 'custom_query',
        customQuery,
      })
      .returning({ id: reportDefinitions.id })
    return row!.id
  })

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: newId,
    action: 'create',
    summary: `Created custom report definition "${name}"`,
    after: { name, slug, category, queryKind: 'custom_query', clonedFrom: cloneFromIdRaw || null },
  })

  revalidatePath('/reports')
  revalidatePath('/reports/definitions')
  redirect(`/reports/definitions/${newId}` as any)
}
