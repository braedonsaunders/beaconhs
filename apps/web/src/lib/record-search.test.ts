import { and, eq, isNull } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { equipmentItems } from '@beaconhs/db/schema'
import { describe, expect, it } from 'vitest'
import { recordSearchTerm, recordSearchWhere } from './record-search'
import { equipmentRegisterQuery } from './equipment/register-query'

const dialect = new PgDialect()
const compile = (kind: Parameters<typeof recordSearchWhere>[0], query: string) =>
  dialect.sqlToQuery(recordSearchWhere(kind, query)!)

describe('record search independent of visible table columns', () => {
  it('matches plates and VINs with spaces and hyphens removed, without changing the literal query', () => {
    const query = compile('equipment', '  AbCd- 123  ')
    expect(query.sql).toContain('"equipment_items"."license_plate" ilike')
    expect(query.sql).toContain('"equipment_items"."vin" ilike')
    expect(query.sql).toContain('regexp_replace("equipment_items"."license_plate",')
    expect(query.params).toContain('%AbCd- 123%')
    expect(query.params).toContain('%AbCd123%')
    expect(query.sql).not.toContain('AbCd')
  })

  it('uses literal substring searches for wildcard and backslash input, including normalized identifiers', () => {
    expect(recordSearchTerm('  50%_\\unit  ')).toBe('%50\\%\\_\\\\unit%')
    const query = compile('equipment', '  A%-_  ')
    expect(query.params).toContain('%A\\%\\_%')
    expect(compile('equipment', ' - ').sql).not.toContain('regexp_replace')
    expect(recordSearchWhere('equipment', undefined)).toBeUndefined()
    expect(recordSearchWhere('equipment', '  ')).toBeUndefined()
  })

  it('searches business details and tenant-correlated classifications without joining the outer query', () => {
    const query = compile('equipment', 'Ford')
    for (const column of ['manufacturer', 'model', 'description', 'notes']) {
      expect(query.sql).toContain(`"equipment_items"."${column}" ilike`)
    }
    for (const table of ['departments', 'equipment_types', 'equipment_categories']) {
      expect(query.sql).toContain(`"${table}"."tenant_id" = "equipment_items"."tenant_id"`)
    }
    expect(query.sql).not.toContain('qr_token')
    expect(query.sql).not.toContain('metadata')
  })

  it('keeps register status, soft deletion, and caller visibility outside the match OR', () => {
    const scope = eq(equipmentItems.currentSiteOrgUnitId, '10000000-0000-4000-8000-000000000001')
    const query = dialect.sqlToQuery(equipmentRegisterQuery({ q: 'ABCD123' }, scope).where!)
    expect(query.sql).toContain('"equipment_items"."deleted_at" is null and')
    expect(query.sql).toContain('"equipment_items"."current_site_org_unit_id" =')
    expect(query.sql).toMatch(/and "equipment_items"\."status" =/)
    expect(query.params).toContain('in_service')
    const global = dialect.sqlToQuery(
      and(isNull(equipmentItems.deletedAt), scope, recordSearchWhere('equipment', 'ABCD123'))!,
    )
    expect(global.params.slice(1)).toEqual(query.params.slice(1, -1))
  })

  it('finds full names, emails and canonical job titles without searching private identity fields', () => {
    const query = compile('people', 'Ryan Stirtzinger')
    expect(query.sql).toContain('"people"."first_name" ||')
    expect(query.sql).toContain('"people"."email" ilike')
    expect(query.sql).toContain('"people"."formal_name" ilike')
    expect(query.sql).toContain('person_title_assignments')
    expect(query.sql).not.toContain('date_of_birth')
    expect(query.sql).not.toContain('badge_token')
    expect(query.sql).not.toContain('emergency_contact')
  })

  it('matches document keys/descriptions, hazard scope/location and corrective-action resolution details', () => {
    expect(compile('documents', 'DOC-001').sql).toContain('"documents"."key" ilike')
    expect(compile('documents', 'fall protection').sql).toContain('"documents"."description" ilike')
    expect(compile('hazid_assessments', 'roof').sql).toContain(
      '"hazid_assessments"."job_scope" ilike',
    )
    expect(compile('hazid_assessments', 'roof').sql).toContain(
      '"hazid_assessments"."location_on_site" ilike',
    )
    const query = compile('corrective_actions', 'replace')
    for (const column of ['description', 'root_cause', 'action_taken', 'verification_notes']) {
      expect(query.sql).toContain(`"corrective_actions"."${column}" ilike`)
    }
  })
})
