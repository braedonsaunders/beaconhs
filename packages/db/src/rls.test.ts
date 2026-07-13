import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'

describe('tenant RLS registry', () => {
  it('exactly covers every Drizzle table with a tenant_id column', () => {
    const schemaTables = [
      ...new Set(
        Object.values(schema)
          .filter((value) => is(value, PgTable))
          .filter((table) => 'tenantId' in getTableColumns(table))
          .map((table) => getTableName(table)),
      ),
    ].sort()

    expect([...TENANT_SCOPED_TABLES].sort()).toEqual(schemaTables)
  })

  it('keeps ordinary tenant policies on one index-usable equality', () => {
    const policy = RLS_POLICY_SQL('attachments')

    expect(policy).toContain(
      "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    )
    expect(policy).not.toContain('tenant_id IS NULL OR')
  })

  it('makes global report definitions readable but never writable by tenant roles', () => {
    const policy = RLS_POLICY_SQL('report_definitions')

    expect(policy).toContain('FOR SELECT')
    expect(policy).toContain('USING (tenant_id IS NULL OR tenant_id =')
    expect(policy).toContain('FOR INSERT')
    expect(policy).toContain('FOR UPDATE')
    expect(policy).toContain('FOR DELETE')
    expect(policy).not.toContain('WITH CHECK (tenant_id IS NULL')
  })
})
