import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { equipmentCheckouts } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0012_organic_vivisector.sql')

describe('equipment open-checkout uniqueness', () => {
  it('models one open checkout per tenant/item as a partial unique key', () => {
    const table = getTableConfig(equipmentCheckouts)
    const index = table.indexes.find(
      (candidate) => candidate.config.name === 'equipment_checkouts_open_item_ux',
    )

    expect(index).toBeDefined()
    expect(index!.config.unique).toBe(true)
    expect(index!.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'tenant_id',
      'equipment_item_id',
    ])
    expect(index!.config.where).toBeDefined()
  })

  it('preflights duplicate open rows across every tenant before durable DDL', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain(
      'Equipment open-checkout uniqueness preflight failed: %s duplicate key group(s), %s excess row(s)',
    )
    expect(migrationSql).toContain('GROUP BY "tenant_id", "equipment_item_id"')
    expect(migrationSql).toContain('WHERE "returned_at" IS NULL')

    const relaxAt = migrationSql.indexOf(
      'ALTER TABLE "equipment_checkouts" NO FORCE ROW LEVEL SECURITY',
    )
    const preflightAt = migrationSql.indexOf('Equipment open-checkout uniqueness preflight failed')
    const restoreAt = migrationSql.indexOf(
      'ALTER TABLE "equipment_checkouts" FORCE ROW LEVEL SECURITY',
    )
    const indexAt = migrationSql.indexOf('CREATE UNIQUE INDEX "equipment_checkouts_open_item_ux"')
    expect(relaxAt).toBeGreaterThanOrEqual(0)
    expect(preflightAt).toBeGreaterThan(relaxAt)
    expect(restoreAt).toBeGreaterThan(preflightAt)
    expect(indexAt).toBeGreaterThan(restoreAt)
  })

  it('limits the key to rows whose return timestamp is null', () => {
    expect(migrationSql).toContain(
      'UNIQUE INDEX "equipment_checkouts_open_item_ux" ON "equipment_checkouts" USING btree ("tenant_id","equipment_item_id") WHERE "equipment_checkouts"."returned_at" is null',
    )
  })
})
