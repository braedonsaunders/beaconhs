import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from './schema'
import { attachments } from './schema'
import {
  ATTACHMENT_TENANT_REFERENCES,
  attachmentTenantConstraintName,
  attachmentTenantConstraintSql,
} from './attachment-integrity'

type TableConfig = ReturnType<typeof getTableConfig>

function allTableConfigs(): TableConfig[] {
  const byName = new Map<string, TableConfig>()
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== 'object') continue
    try {
      const config = getTableConfig(value as Parameters<typeof getTableConfig>[0])
      if (config.name && config.columns.length > 0) byName.set(config.name, config)
    } catch {
      // enums, relations, and type-only exports are not tables
    }
  }
  return [...byName.values()]
}

describe('attachment tenant integrity manifest', () => {
  it('covers every explicit attachment-id column exactly once', () => {
    const discovered = allTableConfigs()
      .flatMap((table) =>
        table.columns
          .filter((column) => column.name.endsWith('attachment_id'))
          .map((column) => `${table.name}.${column.name}`),
      )
      .filter((key) => key !== 'attachments.attachment_id')
      .sort()
    const declared = ATTACHMENT_TENANT_REFERENCES.map(
      (reference) => `${reference.table}.${reference.column}`,
    ).sort()
    expect(declared).toEqual(discovered)
    expect(new Set(declared).size).toBe(declared.length)
  })

  it('does not declare redundant simple attachments.id foreign keys', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const reference of ATTACHMENT_TENANT_REFERENCES) {
      const table = tables.get(reference.table)
      expect(table, reference.table).toBeDefined()
      const matching = table!.foreignKeys.find((foreignKey) => {
        const target = foreignKey.reference()
        return (
          target.columns.length === 1 &&
          target.columns[0]?.name === reference.column &&
          getTableConfig(target.foreignTable).name === 'attachments' &&
          target.foreignColumns.length === 1 &&
          target.foreignColumns[0]?.name === 'id'
        )
      })
      expect(matching, `${reference.table}.${reference.column}`).toBeUndefined()
    }
  })

  it('keeps the composite-only DDL complete and deterministically named', () => {
    const uniqueColumns = getTableConfig(attachments)
      .indexes.filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
    expect(uniqueColumns).toContainEqual(['tenant_id', 'id'])
    const names = ATTACHMENT_TENANT_REFERENCES.map(attachmentTenantConstraintName)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name.length <= 63)).toBe(true)
    for (const reference of ATTACHMENT_TENANT_REFERENCES) {
      const ddl = attachmentTenantConstraintSql(reference)
      expect(ddl).toContain(
        `FOREIGN KEY ("tenant_id", "${reference.column}")\n      REFERENCES "attachments" ("tenant_id", "id")`,
      )
      expect(ddl).toContain(
        reference.onDelete === 'cascade'
          ? 'ON DELETE CASCADE'
          : `ON DELETE SET NULL ("${reference.column}")`,
      )
    }
  })
})
