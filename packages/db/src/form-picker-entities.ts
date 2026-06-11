// Shared entity-attribute loader for picker-bound formulas.
//
// Used by:
//   - the filler RSC (apps/web) — first-render preload + per-picker fetch
//   - the PDF worker (apps/worker) — resolves entity_attr fields before
//     handing the response to renderFormPdf
//
// The web app passes a `RequestContext.db(...)` tx; the worker passes a
// raw `withTenant(...)` tx. Both ultimately hand us a Database / PgTx with
// the tenant RLS context applied, so the queries are identical regardless
// of caller. Keeping this logic in one place avoids divergence between the
// filler's preview and the rendered PDF.
//
// Allowlist contract: the SELECT lists below are the ONLY columns that can
// land on an entity-attr map. Designers cannot widen them — adding a new
// attribute requires editing both ENTITY_ATTRS (forms-core) and the matching
// projection here. SELECT * is never used.

import { inArray } from 'drizzle-orm'
import type { Database } from './client'
import {
  crews,
  departments,
  documents,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  ppeItems,
  ppeTypes,
  trades,
  trainingCourses,
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
  type Triple = { fieldKey: string; kind: EntityKind; id: string }
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
        triples.push({ fieldKey: field.id, kind, id: raw })
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
    equipment: new Map(),
    site: new Map(),
    ppe: new Map(),
    document: new Map(),
    course: new Map(),
  }

  const personIds = idsByKind.get('person')
  if (personIds && personIds.size > 0) {
    const rows = await db
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
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
      .where(inArray(people.id, [...personIds]))

    const managerIds = rows.map((r) => r.managerPersonId).filter((x): x is string => !!x)
    const deptIds = rows.map((r) => r.departmentId).filter((x): x is string => !!x)
    const tradeIds = rows.map((r) => r.tradeId).filter((x): x is string => !!x)
    const crewIds = rows.map((r) => r.crewId).filter((x): x is string => !!x)

    const [managers, depts, trs, crs] = await Promise.all([
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
    ])

    const managerById = new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]))
    const deptById = new Map(depts.map((d) => [d.id, d.name]))
    const tradeById = new Map(trs.map((t) => [t.id, t.name]))
    const crewById = new Map(crs.map((c) => [c.id, c.name]))

    for (const r of rows) {
      result.person.set(r.id, {
        displayName: `${r.firstName} ${r.lastName}`,
        firstName: r.firstName,
        lastName: r.lastName,
        jobTitle: r.jobTitle ?? null,
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

  const equipmentIds = idsByKind.get('equipment')
  if (equipmentIds && equipmentIds.size > 0) {
    const rows = await db
      .select({
        id: equipmentItems.id,
        name: equipmentItems.name,
        assetTag: equipmentItems.assetTag,
        serialNumber: equipmentItems.serialNumber,
        status: equipmentItems.status,
        typeId: equipmentItems.typeId,
        currentSiteOrgUnitId: equipmentItems.currentSiteOrgUnitId,
        currentHolderPersonId: equipmentItems.currentHolderPersonId,
        lastSeenAt: equipmentItems.lastSeenAt,
        lastPreUseInspectionAt: equipmentItems.lastPreUseInspectionAt,
        lastAnnualInspectionOn: equipmentItems.lastAnnualInspectionOn,
        nextAnnualInspectionDue: equipmentItems.nextAnnualInspectionDue,
        isMissing: equipmentItems.isMissing,
        isAvailableForCheckout: equipmentItems.isAvailableForCheckout,
        requiresOilChange: equipmentItems.requiresOilChange,
        nextOilChangeDue: equipmentItems.nextOilChangeDue,
        warrantyExpiresOn: equipmentItems.warrantyExpiresOn,
      })
      .from(equipmentItems)
      .where(inArray(equipmentItems.id, [...equipmentIds]))

    const typeIds = rows.map((r) => r.typeId).filter((x): x is string => !!x)
    const siteIds = rows.map((r) => r.currentSiteOrgUnitId).filter((x): x is string => !!x)
    const holderIds = rows.map((r) => r.currentHolderPersonId).filter((x): x is string => !!x)

    const [types, sites, holders] = await Promise.all([
      typeIds.length > 0
        ? db
            .select({ id: equipmentTypes.id, name: equipmentTypes.name })
            .from(equipmentTypes)
            .where(inArray(equipmentTypes.id, typeIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      siteIds.length > 0
        ? db
            .select({ id: orgUnits.id, name: orgUnits.name })
            .from(orgUnits)
            .where(inArray(orgUnits.id, siteIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      holderIds.length > 0
        ? db
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
            })
            .from(people)
            .where(inArray(people.id, holderIds))
        : Promise.resolve([] as { id: string; firstName: string; lastName: string }[]),
    ])

    const typeNameById = new Map(types.map((t) => [t.id, t.name]))
    const siteNameById = new Map(sites.map((s) => [s.id, s.name]))
    const holderNameById = new Map(holders.map((h) => [h.id, `${h.firstName} ${h.lastName}`]))

    for (const r of rows) {
      result.equipment.set(r.id, {
        name: r.name,
        assetTag: r.assetTag,
        serialNumber: r.serialNumber ?? null,
        status: r.status,
        typeName: r.typeId ? (typeNameById.get(r.typeId) ?? null) : null,
        currentSiteName: r.currentSiteOrgUnitId
          ? (siteNameById.get(r.currentSiteOrgUnitId) ?? null)
          : null,
        currentHolderName: r.currentHolderPersonId
          ? (holderNameById.get(r.currentHolderPersonId) ?? null)
          : null,
        lastSeenAt: r.lastSeenAt ?? null,
        lastPreUseInspectionAt: r.lastPreUseInspectionAt ?? null,
        lastAnnualInspectionOn: r.lastAnnualInspectionOn ?? null,
        nextAnnualInspectionDue: r.nextAnnualInspectionDue ?? null,
        isMissing: r.isMissing,
        isAvailableForCheckout: r.isAvailableForCheckout,
        requiresOilChange: r.requiresOilChange,
        nextOilChangeDue: r.nextOilChangeDue ?? null,
        warrantyExpiresOn: r.warrantyExpiresOn ?? null,
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
      .where(inArray(orgUnits.id, [...siteRowIds]))
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

  const ppeIds = idsByKind.get('ppe')
  if (ppeIds && ppeIds.size > 0) {
    const rows = await db
      .select({
        id: ppeItems.id,
        serialNumber: ppeItems.serialNumber,
        size: ppeItems.size,
        status: ppeItems.status,
        typeId: ppeItems.typeId,
        currentHolderPersonId: ppeItems.currentHolderPersonId,
        expiresOn: ppeItems.expiresOn,
        lastInspectionOn: ppeItems.lastInspectionOn,
        nextInspectionDue: ppeItems.nextInspectionDue,
      })
      .from(ppeItems)
      .where(inArray(ppeItems.id, [...ppeIds]))

    const typeIds = rows.map((r) => r.typeId).filter((x): x is string => !!x)
    const holderIds = rows.map((r) => r.currentHolderPersonId).filter((x): x is string => !!x)
    const [types, holders] = await Promise.all([
      typeIds.length > 0
        ? db
            .select({
              id: ppeTypes.id,
              name: ppeTypes.name,
              category: ppeTypes.category,
            })
            .from(ppeTypes)
            .where(inArray(ppeTypes.id, typeIds))
        : Promise.resolve([] as { id: string; name: string; category: string | null }[]),
      holderIds.length > 0
        ? db
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
            })
            .from(people)
            .where(inArray(people.id, holderIds))
        : Promise.resolve([] as { id: string; firstName: string; lastName: string }[]),
    ])
    const typeById = new Map(types.map((t) => [t.id, t]))
    const holderNameById = new Map(holders.map((h) => [h.id, `${h.firstName} ${h.lastName}`]))
    for (const r of rows) {
      const tp = r.typeId ? typeById.get(r.typeId) : undefined
      result.ppe.set(r.id, {
        serialNumber: r.serialNumber ?? null,
        size: r.size ?? null,
        status: r.status,
        typeName: tp?.name ?? null,
        category: tp?.category ?? null,
        currentHolderName: r.currentHolderPersonId
          ? (holderNameById.get(r.currentHolderPersonId) ?? null)
          : null,
        expiresOn: r.expiresOn ?? null,
        lastInspectionOn: r.lastInspectionOn ?? null,
        nextInspectionDue: r.nextInspectionDue ?? null,
      })
    }
  }

  const documentIds = idsByKind.get('document')
  if (documentIds && documentIds.size > 0) {
    const rows = await db
      .select({
        id: documents.id,
        key: documents.key,
        title: documents.title,
        category: documents.category,
        status: documents.status,
        nextReviewOn: documents.nextReviewOn,
      })
      .from(documents)
      .where(inArray(documents.id, [...documentIds]))
    for (const r of rows) {
      result.document.set(r.id, {
        key: r.key,
        title: r.title,
        category: r.category ?? null,
        status: r.status,
        nextReviewOn: r.nextReviewOn ?? null,
      })
    }
  }

  const courseIds = idsByKind.get('course')
  if (courseIds && courseIds.size > 0) {
    const rows = await db
      .select({
        id: trainingCourses.id,
        code: trainingCourses.code,
        name: trainingCourses.name,
        deliveryType: trainingCourses.deliveryType,
        durationMinutes: trainingCourses.durationMinutes,
        validForMonths: trainingCourses.validForMonths,
        requiresEvaluator: trainingCourses.requiresEvaluator,
      })
      .from(trainingCourses)
      .where(inArray(trainingCourses.id, [...courseIds]))
    for (const r of rows) {
      result.course.set(r.id, {
        code: r.code,
        name: r.name,
        deliveryType: r.deliveryType,
        durationMinutes: r.durationMinutes ?? null,
        validForMonths: r.validForMonths ?? null,
        requiresEvaluator: r.requiresEvaluator,
      })
    }
  }

  // Step 4: stitch the per-kind results back onto each picker field key.
  // Stamp `__entityKind` on every entry so the evaluator can resolve the
  // EntityAttrDef from the registry.
  for (const t of triples) {
    const entity = result[t.kind].get(t.id)
    if (entity) {
      out[t.fieldKey] = { ...entity, __entityKind: t.kind }
    }
  }
  return out
}
