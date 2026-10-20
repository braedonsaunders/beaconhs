import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { inspectionRecords, people } from '@beaconhs/db/schema'

/** Resolve only the selected people, including historical inactive names. */
export async function inspectionForemanNames(
  tx: Database,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await tx
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
    .from(people)
    .where(and(eq(people.tenantId, tenantId), inArray(people.id, [...new Set(ids)])))
  return new Map(rows.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]))
}

export function inspectionForemanLabel(
  record: { foremanPersonIds: string[]; foremanText: string | null },
  names: ReadonlyMap<string, string>,
): string {
  return record.foremanPersonIds.length
    ? record.foremanPersonIds.map((id) => names.get(id) || 'Unavailable person').join(', ')
    : (record.foremanText ?? '')
}

/** Correlated EXISTS keeps list counts and pagination independent of roster size. */
export function inspectionForemanMatches(term: string) {
  return sql<boolean>`exists (
    select 1 from ${people}
    where ${people.tenantId} = ${inspectionRecords.tenantId}
      and ${inspectionRecords.foremanPersonIds} @> jsonb_build_array(${people.id}::text)
      and concat_ws(' ', ${people.firstName}, ${people.lastName}) ilike ${term}
  )`
}
