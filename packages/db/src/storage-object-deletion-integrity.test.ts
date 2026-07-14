import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { TENANT_SCOPED_TABLES } from './rls'
import { storageObjectDeletionOutbox, storageObjectDeletionStatus } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0019_storage_object_deletion_outbox.sql')
const table = getTableConfig(storageObjectDeletionOutbox)

describe('storage object deletion physical integrity', () => {
  it('models only live work with a restrictive tenant relationship and exact lease state', () => {
    expect(storageObjectDeletionStatus.enumValues).toEqual(['pending', 'deleting'])
    expect(table.columns.map((column) => column.name)).not.toContain('deleted_at')

    const tenantFk = table.foreignKeys.find(
      (foreignKey) => foreignKey.reference().columns[0]?.name === 'tenant_id',
    )
    expect(tenantFk).toBeDefined()
    expect(tenantFk?.onDelete ?? 'no action').toBe('no action')

    expect(table.checks.map((check) => check.name).sort()).toEqual([
      'storage_object_deletion_outbox_attempts_ck',
      'storage_object_deletion_outbox_lease_state_ck',
      'storage_object_deletion_outbox_tenant_key_ck',
    ])
    expect(TENANT_SCOPED_TABLES).toContain('storage_object_deletion_outbox')
  })

  it('has one active intent per attachment and object key without permanent tombstones', () => {
    const indexes = new Map(table.indexes.map((index) => [index.config.name, index.config]))
    expect(indexes.get('storage_object_deletion_outbox_attachment_ux')?.unique).toBe(true)
    expect(indexes.get('storage_object_deletion_outbox_object_key_ux')?.unique).toBe(true)
    expect(migrationSql).not.toContain("'deleted'")
    expect(migrationSql).not.toContain('deleted_at')
  })

  it('preflights all attachment keys before installing the durable trigger', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    const relaxAt = migrationSql.indexOf('ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY')
    const preflightAt = migrationSql.indexOf('Attachment storage-key preflight failed')
    const restoreAt = migrationSql.indexOf('ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY')
    const tableAt = migrationSql.indexOf('CREATE TABLE "storage_object_deletion_outbox"')
    expect(relaxAt).toBeGreaterThanOrEqual(0)
    expect(preflightAt).toBeGreaterThan(relaxAt)
    expect(restoreAt).toBeGreaterThan(preflightAt)
    expect(tableAt).toBeGreaterThan(restoreAt)
  })

  it('rolls back rather than dropping a conflicting deletion intent', () => {
    const enqueueStart = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION "enqueue_attachment_storage_object_deletion"',
    )
    const enqueueEnd = migrationSql.indexOf('$$;--> statement-breakpoint', enqueueStart)
    const enqueueBody = migrationSql.slice(enqueueStart, enqueueEnd)
    expect(enqueueBody).toContain('INSERT INTO public.storage_object_deletion_outbox')
    expect(enqueueBody).not.toContain('ON CONFLICT')
    expect(migrationSql).toContain('AFTER DELETE ON "attachments"')
  })

  it('prevents cross-tenant and active-intent key reuse on inserts and key changes', () => {
    expect(migrationSql).toContain("NEW.r2_key NOT LIKE ('t/' || NEW.tenant_id::text || '/%')")
    expect(migrationSql).toContain('Attachment object key has an active deletion intent')
    expect(migrationSql).toContain(
      'BEFORE INSERT OR UPDATE OF "tenant_id", "r2_key" ON "attachments"',
    )
  })
})
