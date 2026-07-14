import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { complianceDispatches, equipmentMaintenanceDispatches, reportRuns } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const ledgers = [
  { name: 'report_runs', table: reportRuns },
  { name: 'compliance_dispatches', table: complianceDispatches },
  { name: 'equipment_maintenance_dispatches', table: equipmentMaintenanceDispatches },
] as const

const migrationSql = readProductionCutoverSection('0022_durable_publication_leases.sql')

describe('durable publication ledger integrity', () => {
  it.each(ledgers)('$name has a fair retry cursor and an exact lease pair', ({ name, table }) => {
    const config = getTableConfig(table)
    const columns = new Map(config.columns.map((column) => [column.name, column]))

    expect(columns.get('publish_attempts')?.notNull).toBe(true)
    expect(columns.get('publish_available_at')?.notNull).toBe(true)
    expect(columns.get('publish_lease_id')?.notNull).toBe(false)
    expect(columns.get('publish_claimed_at')?.notNull).toBe(false)

    const checks = config.checks.map((check) => check.name)
    expect(checks).toContain(`${name}_publish_attempts_ck`)
    expect(checks).toContain(`${name}_publish_lease_state_ck`)

    const indexes = config.indexes.map((index) => index.config.name)
    expect(indexes).toContain(`${name}_publish_available_idx`)
    expect(indexes).toContain(`${name}_publish_claimed_idx`)
  })

  it('migrates only the canonical publisher ledgers with additive, safe defaults', () => {
    for (const { name } of ledgers) {
      for (const column of [
        'publish_attempts',
        'publish_available_at',
        'publish_lease_id',
        'publish_claimed_at',
      ]) {
        expect(migrationSql).toContain(`ALTER TABLE "${name}" ADD COLUMN "${column}"`)
      }
      expect(migrationSql).toContain(`CREATE INDEX "${name}_publish_available_idx"`)
      expect(migrationSql).toContain(`CREATE INDEX "${name}_publish_claimed_idx"`)
      expect(migrationSql).toContain(`ADD CONSTRAINT "${name}_publish_attempts_ck"`)
      expect(migrationSql).toContain(`ADD CONSTRAINT "${name}_publish_lease_state_ck"`)
    }

    // The historical cutover also hardened the retired form-assignment ledger.
    // Its DDL remains in that immutable section, while runtime schema coverage
    // is intentionally limited to the three canonical ledgers above.
    expect(migrationSql.match(/ADD COLUMN/g)).toHaveLength(16)
    expect(migrationSql.match(/CREATE INDEX/g)).toHaveLength(8)
    expect(migrationSql.match(/ADD CONSTRAINT/g)).toHaveLength(8)
    expect(migrationSql).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\b/)
  })
})
