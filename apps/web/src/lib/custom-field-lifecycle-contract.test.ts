import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return text.slice(startIndex, endIndex)
}

describe('custom-field lifecycle contract', () => {
  const actions = source('./custom-fields/actions.ts')

  it('serializes value writes against definition edits and audits in the same transaction', () => {
    const update = between(
      actions,
      'export async function updateCustomFieldValueAction',
      'export type SaveCustomFieldInput',
    )
    expect(update).toContain(".for('share')")
    expect(update.indexOf(".for('share')")).toBeLessThan(
      update.indexOf('writeMetadataInTransaction('),
    )
    expect(update.indexOf('writeMetadataInTransaction(')).toBeLessThan(
      update.indexOf('recordAuditInTransaction('),
    )
    expect(update).not.toContain('recordAudit(ctx')
    expect(actions).toContain('subtypeId ? eq(equipmentItems.typeId, subtypeId) : undefined')
    expect(actions).toContain('subtypeId ? eq(ppeItems.typeId, subtypeId) : undefined')
  })

  it('keeps definition updates, value migrations, scope cleanup, and audit atomic', () => {
    const save = between(
      actions,
      'export async function saveCustomFieldDefAction',
      '/** Hard-delete a definition',
    )
    const ownerLock = save.indexOf(".for('update')")
    expect(ownerLock).toBeGreaterThanOrEqual(0)
    expect(save.indexOf('normalizeChoiceValuesInTransaction(', ownerLock)).toBeGreaterThan(
      ownerLock,
    )
    expect(save.indexOf('normalizeNumericValuesInTransaction(', ownerLock)).toBeGreaterThan(
      ownerLock,
    )
    expect(save.indexOf('purgeMetadataKeyInTransaction(', ownerLock)).toBeGreaterThan(ownerLock)
    expect(save).toContain('recordAuditInTransaction(tx, ctx')
    expect(save).not.toContain('recordAudit(ctx')
    expect(actions).toContain(".for('key share')")
    expect(save).toContain('isSaveInputShape(input)')
  })

  it('purges retired keys before freeing them and records the delete atomically', () => {
    const remove = actions.slice(
      actions.indexOf('export async function deleteCustomFieldDefAction'),
    )
    const ownerLock = remove.indexOf(".for('update')")
    const dependencyCheck = remove.indexOf('findCustomFieldAnalyticsDependencies(')
    const purge = remove.indexOf('purgeMetadataKeyInTransaction(')
    const deletion = remove.indexOf('.delete(customFieldDefinitions)')
    const audit = remove.indexOf('recordAuditInTransaction(')
    expect(ownerLock).toBeGreaterThanOrEqual(0)
    expect(dependencyCheck).toBeGreaterThan(ownerLock)
    expect(purge).toBeGreaterThan(dependencyCheck)
    expect(deletion).toBeGreaterThan(purge)
    expect(audit).toBeGreaterThan(deletion)
    expect(remove).not.toContain('recordAudit(ctx')
    expect(actions).not.toContain('sql.raw')
  })

  it('serializes analytics plans against field hiding and deletion', () => {
    const save = between(
      actions,
      'export async function saveCustomFieldDefAction',
      '/** Hard-delete a definition',
    )
    const reportActions = source('../app/(app)/reports/_studio/actions.ts')
    const cardActions = source('../app/(app)/insights/cards/_actions.ts')
    const customColumns = source('../../../../packages/reports/src/custom-fields.ts')
    expect(save).toContain('existing.isActive && !input.isActive')
    expect(save).toContain('findCustomFieldAnalyticsDependencies(')
    expect(customColumns).toContain(".for('key share')")
    expect(reportActions).toContain('recordAuditInTransaction(tx, ctx')
    expect(reportActions).not.toContain('recordAudit(ctx')
    expect(cardActions).toContain('recordAuditInTransaction(tx, ctx')
  })

  it('blocks subtype deletion while scoped definitions still depend on it', () => {
    const retirement = source('./custom-fields/subtype-retirement.ts')
    const equipment = source('../app/(app)/equipment/types/page.tsx')
    const ppe = source('./ppe-type-deletion.ts')
    expect(retirement).toContain('isNull(customFieldDefinitions.deletedAt)')
    expect(retirement).toContain('eq(customFieldDefinitions.subtypeId, subtypeId)')
    expect(equipment).toContain("countScopedCustomFields(tx, ctx.tenantId, 'equipment', id)")
    expect(ppe).toContain("assertSubtypeHasNoCustomFields(tx, tenantId, 'ppe', typeId)")
  })

  it('warns before every destructive definition change and documents permanent deletion', () => {
    const designer = source('../components/custom-fields/custom-fields-designer-drawer.tsx')
    const admin = source('../components/custom-fields/custom-fields-admin-page.tsx')
    expect(designer).toContain('destructiveChanges')
    expect(designer).toContain('saved selections using')
    expect(designer).toContain('saved numbers that do not fit')
    expect(designer).toContain("tGenerated('m_10aac5db2ebced'")
    expect(admin).toContain("tGenerated('m_12888ae5874f1b'")
  })
})
