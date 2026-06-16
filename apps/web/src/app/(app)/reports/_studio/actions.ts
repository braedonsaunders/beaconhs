'use server'

// Server actions for the report studio: create / update custom definitions
// and the live preview. All three share the validate.ts sanitiser; preview
// executes under the caller's RLS context with a tight row cap.

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportDefinitions } from '@beaconhs/db/schema'
import { computeRangeFor, runReport, type ReportRunResult } from '@beaconhs/reports'
import { discoverEntityMap } from '@beaconhs/analytics/server'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { validateCustomQuery } from './validate'

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

function parseStudioForm(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const customQueryRaw = String(formData.get('customQuery') ?? '').trim()
  if (!name) throw new Error('Name is required')
  if (!customQueryRaw) throw new Error('Custom query payload is missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(customQueryRaw)
  } catch (err) {
    throw new Error(`Invalid customQuery JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { name, description, customQuery: validateCustomQuery(parsed) }
}

export async function createCustomDefinition(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const { name, description, customQuery } = parseStudioForm(formData)
  const cloneFromIdRaw = String(formData.get('cloneFromId') ?? '').trim()

  // If cloning, copy source category onto the new row.
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
  redirect(`/reports/definitions/${newId}` as never)
}

export async function updateCustomDefinition(
  definitionId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await requireRequestContext()
  const { name, description, customQuery } = parseStudioForm(formData)

  await withSuperAdmin(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, definitionId))
      .limit(1)
    if (!d) throw new Error('Definition not found')
    if (d.kind !== 'custom') throw new Error('Built-in definitions cannot be edited')
    if (d.tenantId !== ctx.tenantId) {
      throw new Error('Cannot edit a definition owned by another tenant')
    }
    await tx
      .update(reportDefinitions)
      .set({ name, description, category: customQuery.entity, customQuery, updatedAt: new Date() })
      .where(eq(reportDefinitions.id, definitionId))
  })

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: definitionId,
    action: 'update',
    summary: `Updated custom report definition "${name}"`,
    after: { name },
  })

  revalidatePath('/reports')
  revalidatePath('/reports/definitions')
  revalidatePath(`/reports/definitions/${definitionId}`)
  redirect(`/reports/definitions/${definitionId}` as never)
}

export type StudioPreviewResult =
  | { ok: true; result: ReportRunResult; rangeLabel: string }
  | { ok: false; error: string }

const PREVIEW_MAX_ROWS = 25

export async function previewCustomReport(payload: unknown): Promise<StudioPreviewResult> {
  try {
    const ctx = await requireRequestContext()
    const customQuery = validateCustomQuery(payload)
    const range = computeRangeFor('custom_query', {})
    const result = await ctx.db((tx) =>
      runReport(tx, {
        queryKind: 'custom_query',
        filters: {},
        range,
        customQuery,
        maxRows: PREVIEW_MAX_ROWS,
        entityMap: discoverEntityMap(),
      }),
    )
    return { ok: true, result, rangeLabel: range.label }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
