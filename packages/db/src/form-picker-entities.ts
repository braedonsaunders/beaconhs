// Shared entity-attribute loader for picker-bound formulas.
//
// Used by:
//   - the filler RSC (apps/web) — first-render preload + per-picker fetch
//   - the form flow adapter (apps/web) — resolves entity_attr fields so PDF
//     and email templates print the same live values the filler showed
//
// Callers pass a `RequestContext.db(...)` tx (or any tenant-scoped tx), so
// the queries are identical regardless of caller. Keeping this logic in one
// place avoids divergence between the filler's preview and rendered output.
//
// Allowlist contract: the SELECT lists below are the ONLY columns that can
// land on an entity-attr map. Designers cannot widen them — adding a new
// attribute requires editing both ENTITY_ATTRS (forms-core) and the matching
// projection here. SELECT * is never used.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from './client'
import {
  crews,
  departments,
  orgUnits,
  people,
  personTitleAssignments,
  personTitles,
  trades,
} from './schema'
import { entityKindForPicker, type EntityKind, type FormSchemaV1 } from '@beaconhs/forms-core'

export type EntitiesByField = Record<string, Record<string, unknown> | null>

/**
 * Walk every (non-repeating) section's picker fields and produce the
 * `entitiesByField` map. Repeating-row picker fields are skipped — their
 * attrs would need per-row resolution, and the evaluator currently looks
 * up entities by top-level field key only.
 *
 * `db` must be a tenant-scoped tx (e.g. inside `withTenant(...)` or
 * `ctx.db(async (tx) => loadEntitiesForFormPickers(tx, …))`). Cross-tenant
 * leakage is impossible because every table here is gated by tenantId via
 * the per-tenant RLS policies.
 */
export async function loadEntitiesForFormPickers(
  db: Database,
  schema: FormSchemaV1,
  values: Record<string, unknown>,
): Promise<EntitiesByField> {
  // Step 1: collect (pickerFieldKey, entityKind, id) triples for every
  // top-level single-entity picker with a value.
  type Triple = { fieldKey: string; fieldType: string; kind: EntityKind; id: string }
  const triples: Triple[] = []
  const pickerFieldKinds = new Map<string, EntityKind>()
  for (const sec of schema.sections) {
    if (sec.repeating) continue
    for (const field of sec.fields) {
      const kind = entityKindForPicker(field.type)
      if (!kind) continue
      pickerFieldKinds.set(field.id, kind)
      const raw = values[field.id]
      if (typeof raw === 'string' && raw.length > 0) {
        triples.push({ fieldKey: field.id, fieldType: field.type, kind, id: raw })
      }
    }
  }

  // Initialize the output map so every picker field key has an entry, even
  // when null — gives the evaluator a stable lookup surface.
  const out: EntitiesByField = {}
  for (const [fieldKey] of pickerFieldKinds) out[fieldKey] = null

  if (triples.length === 0) return out

  // Step 2: group ids by entity kind for batched lookups.
  const idsByKind = new Map<EntityKind, Set<string>>()
  for (const t of triples) {
    let s = idsByKind.get(t.kind)
    if (!s) {
      s = new Set()
      idsByKind.set(t.kind, s)
    }
    s.add(t.id)
  }

  // Step 3: one batched query per kind.
  const result: Record<EntityKind, Map<string, Record<string, unknown>>> = {
    person: new Map(),
    site: new Map(),
  }

  const personIds = idsByKind.get('person')
  if (personIds && personIds.size > 0) {
    const rows = await db
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        email: people.email,
        phone: people.phone,
        status: people.status,
        hireDate: people.hireDate,
        managerPersonId: people.managerPersonId,
        departmentId: people.departmentId,
        tradeId: people.tradeId,
        crewId: people.crewId,
      })
      .from(people)
      .where(
        and(
          inArray(people.id, [...personIds]),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )

    const managerIds = rows.map((r) => r.managerPersonId).filter((x): x is string => !!x)
    const deptIds = rows.map((r) => r.departmentId).filter((x): x is string => !!x)
    const tradeIds = rows.map((r) => r.tradeId).filter((x): x is string => !!x)
    const crewIds = rows.map((r) => r.crewId).filter((x): x is string => !!x)

    const [managers, depts, trs, crs, primaryTitles] = await Promise.all([
      managerIds.length > 0
        ? db
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
            })
            .from(people)
            .where(inArray(people.id, managerIds))
        : Promise.resolve([] as { id: string; firstName: string; lastName: string }[]),
      deptIds.length > 0
        ? db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, deptIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      tradeIds.length > 0
        ? db
            .select({ id: trades.id, name: trades.name })
            .from(trades)
            .where(inArray(trades.id, tradeIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      crewIds.length > 0
        ? db
            .select({ id: crews.id, name: crews.name })
            .from(crews)
            .where(inArray(crews.id, crewIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      db
        .select({ personId: personTitleAssignments.personId, name: personTitles.name })
        .from(personTitleAssignments)
        .innerJoin(
          personTitles,
          and(
            eq(personTitles.tenantId, personTitleAssignments.tenantId),
            eq(personTitles.id, personTitleAssignments.titleId),
          ),
        )
        .where(
          and(
            inArray(
              personTitleAssignments.personId,
              rows.map((row) => row.id),
            ),
            eq(personTitleAssignments.isPrimary, true),
            isNull(personTitles.deletedAt),
          ),
        ),
    ])

    const managerById = new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]))
    const deptById = new Map(depts.map((d) => [d.id, d.name]))
    const tradeById = new Map(trs.map((t) => [t.id, t.name]))
    const crewById = new Map(crs.map((c) => [c.id, c.name]))
    const primaryTitleByPersonId = new Map(
      primaryTitles.map((title) => [title.personId, title.name]),
    )

    for (const r of rows) {
      result.person.set(r.id, {
        displayName: `${r.firstName} ${r.lastName}`,
        firstName: r.firstName,
        lastName: r.lastName,
        jobTitle: primaryTitleByPersonId.get(r.id) ?? null,
        employeeNo: r.employeeNo ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        status: r.status,
        hireDate: r.hireDate ?? null,
        managerName: r.managerPersonId ? (managerById.get(r.managerPersonId) ?? null) : null,
        departmentName: r.departmentId ? (deptById.get(r.departmentId) ?? null) : null,
        tradeName: r.tradeId ? (tradeById.get(r.tradeId) ?? null) : null,
        crewName: r.crewId ? (crewById.get(r.crewId) ?? null) : null,
      })
    }
  }

  const siteRowIds = idsByKind.get('site')
  if (siteRowIds && siteRowIds.size > 0) {
    const rows = await db
      .select({
        id: orgUnits.id,
        name: orgUnits.name,
        code: orgUnits.code,
        level: orgUnits.level,
        address: orgUnits.address,
      })
      .from(orgUnits)
      .where(and(inArray(orgUnits.id, [...siteRowIds]), isNull(orgUnits.deletedAt)))
    for (const r of rows) {
      const addr = (r.address ?? {}) as {
        line1?: string
        line2?: string
        city?: string
        region?: string
        postal?: string
        country?: string
      }
      const addressLine = [
        addr.line1,
        addr.line2,
        addr.city,
        addr.region,
        addr.postal,
        addr.country,
      ]
        .filter(Boolean)
        .join(', ')
      result.site.set(r.id, {
        name: r.name,
        code: r.code ?? null,
        level: r.level,
        addressLine: addressLine || null,
        city: addr.city ?? null,
        region: addr.region ?? null,
        postal: addr.postal ?? null,
        country: addr.country ?? null,
      })
    }
  }

  // Step 4: stitch the per-kind results back onto each picker field key.
  // Stamp `__entityKind` on every entry so the evaluator can resolve the
  // EntityAttrDef from the registry.
  const orgUnitLevelByPicker: Record<string, string> = {
    customer_picker: 'customer',
    project_picker: 'project',
    site_picker: 'site',
    area_picker: 'area',
  }
  for (const t of triples) {
    const entity = result[t.kind].get(t.id)
    const expectedOrgUnitLevel = orgUnitLevelByPicker[t.fieldType]
    if (
      entity &&
      (t.kind !== 'site' ||
        (expectedOrgUnitLevel !== undefined && entity.level === expectedOrgUnitLevel))
    ) {
      out[t.fieldKey] = { ...entity, __entityKind: t.kind }
    }
  }
  return out
}
