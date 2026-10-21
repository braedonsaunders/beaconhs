'use server'

import { and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm'
import { documentVersions } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { loadSkillConditionFields } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import type { PickerOptionsResponse } from '@/lib/picker-options'

export async function obligationTargetOptions(input: {
  kind: 'version' | 'skill_field'
  contextId: string
  query: string
  selected: string | null
}): Promise<PickerOptionsResponse> {
  const ctx = await requireRequestContext()
  if (
    !(can(ctx, 'compliance.assign') || can(ctx, 'compliance.manage')) ||
    !isUuid(input.contextId) ||
    (input.selected && !isUuid(input.selected))
  )
    throw new Error('Not allowed')
  const query = input.query.trim().slice(0, 100)
  return ctx.db(async (tx) => {
    if (input.kind === 'version') {
      const rows = await tx
        .select({ id: documentVersions.id, version: documentVersions.version })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.tenantId, ctx.tenantId),
            eq(documentVersions.documentId, input.contextId),
            isNotNull(documentVersions.publishedAt),
            query
              ? or(
                  ilike(
                    sql`${documentVersions.version}::text`,
                    `%${query.replace(/[\\%_]/g, '\\$&')}%`,
                  ),
                  input.selected ? eq(documentVersions.id, input.selected) : undefined,
                )
              : undefined,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${documentVersions.id} = ${input.selected}`)] : []),
          desc(documentVersions.version),
        )
        .limit(26)
      return {
        options: rows.slice(0, 25).map((row) => ({ value: row.id, label: `v${row.version}` })),
        hasMore: rows.length > 25,
      }
    }
    const fields = await loadSkillConditionFields(
      tx as Parameters<typeof loadSkillConditionFields>[0],
      ctx.tenantId,
      input.contextId,
    )
    const byKey = new Map<string, (typeof fields)[number]>()
    for (const f of fields.sort(
      (a, b) =>
        Number(b.id === input.selected) - Number(a.id === input.selected) ||
        Number(Boolean(b.skillTypeId)) - Number(Boolean(a.skillTypeId)),
    ))
      if (!byKey.has(f.fieldKey.toLowerCase())) byKey.set(f.fieldKey.toLowerCase(), f)
    const matched = [...byKey.values()]
      .filter(
        (f) => f.id === input.selected || f.fieldKey.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(b.id === input.selected) - Number(a.id === input.selected) ||
          a.fieldKey.localeCompare(b.fieldKey),
      )
    return {
      options: matched.slice(0, 25).map((f) => ({ value: f.id, label: f.fieldKey })),
      hasMore: matched.length > 25,
    }
  })
}
