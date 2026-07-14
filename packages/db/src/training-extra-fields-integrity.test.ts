import { readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { trainingExtraFields } from './schema'

const schemaSource = readFileSync(new URL('./schema/training-extras.ts', import.meta.url), 'utf8')

describe('training additional-field integrity', () => {
  const config = getTableConfig(trainingExtraFields)

  it('stores exactly one physical owner on nullable tenant-aware keys', () => {
    expect(config.columns.find((column) => column.name === 'skill_assignment_id')?.notNull).toBe(
      false,
    )
    expect(config.columns.find((column) => column.name === 'skill_type_id')?.notNull).toBe(false)
    expect(config.columns.find((column) => column.name === 'authority_id')?.notNull).toBe(false)
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      'training_extra_fields_exactly_one_owner_ck',
    )
    expect(schemaSource).toContain(
      'num_nonnulls(${t.skillAssignmentId}, ${t.skillTypeId}, ${t.authorityId}) = 1',
    )

    const references = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return `${reference.columns.map((column) => column.name).join(',')}->${reference.foreignColumns
        .map((column) => column.name)
        .join(',')}|${foreignKey.onDelete}`
    })
    expect(references).toEqual(
      expect.arrayContaining([
        'tenant_id,skill_assignment_id->tenant_id,id|cascade',
        'tenant_id,skill_type_id->tenant_id,id|cascade',
        'tenant_id,authority_id->tenant_id,id|cascade',
      ]),
    )
  })

  it('deduplicates field names case-insensitively within each owner only', () => {
    const uniqueIndexes = config.indexes
      .filter((candidate) => candidate.config.unique)
      .map((candidate) => ({
        name: candidate.config.name,
        partial: candidate.config.where != null,
      }))
    expect(uniqueIndexes).toEqual(
      expect.arrayContaining([
        { name: 'training_extra_fields_skill_assignment_key_ux', partial: true },
        { name: 'training_extra_fields_skill_type_key_ux', partial: true },
        { name: 'training_extra_fields_authority_key_ux', partial: true },
      ]),
    )

    for (const [indexName, owner] of [
      ['training_extra_fields_skill_assignment_key_ux', 'skillAssignmentId'],
      ['training_extra_fields_skill_type_key_ux', 'skillTypeId'],
      ['training_extra_fields_authority_key_ux', 'authorityId'],
    ] as const) {
      const start = schemaSource.indexOf(`uniqueIndex('${indexName}')`)
      expect(start, indexName).toBeGreaterThan(-1)
      const declaration = schemaSource.slice(start, start + 300)
      expect(declaration).toContain('sql`lower(${t.fieldKey})`')
      expect(declaration).toContain('.where(sql`' + '${t.' + owner + '} IS NOT NULL`)')
    }
  })
})
