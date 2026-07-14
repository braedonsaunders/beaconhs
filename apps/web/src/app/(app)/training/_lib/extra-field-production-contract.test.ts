import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('training additional-field production contract', () => {
  it('keeps owner validation, write locking, mutation, and audit in one transaction', () => {
    const actions = source('./extra-fields-actions.ts')
    expect(actions).toContain(".for('share')")
    expect(actions).toContain(".for('update')")
    expect(actions).toContain('.onConflictDoNothing()')
    expect(actions).toContain('recordAuditInTransaction')
    expect(actions).toContain('eq(trainingExtraFields.tenantId, ctx.tenantId)')
    expect(actions).not.toContain('ownerType: ownerType')
    expect(actions).not.toContain('ownerId: ownerId')
  })

  it('searches and pages at the database with exact global and filtered totals', () => {
    const query = source('./extra-field-query.ts')
    expect(query.match(/count\(\)/g)).toHaveLength(2)
    expect(query).toContain('ilike(trainingExtraFields.fieldKey')
    expect(query).toContain('ilike(trainingExtraFields.fieldValue')
    expect(query).toContain('.limit(params.perPage)')
    expect(query).toContain('.offset((params.page - 1) * params.perPage)')
    expect(query).toContain('asc(trainingExtraFields.id)')

    const component = source('../_components/extra-fields-section.tsx')
    expect(component).toContain('<SearchInput')
    expect(component).toContain('<Pagination')
    expect(component).toContain('total={list.filteredTotal}')
  })

  it('uses non-colliding URL state and global tab counts on every owner page', () => {
    const authority = source('../authorities/[id]/page.tsx')
    const skillType = source('../skills/types/[id]/page.tsx')
    const assignment = source('../skills/[id]/page.tsx')

    for (const detail of [authority, skillType]) {
      expect(detail).toContain("parsePrefixedListParams(sp, 'extra'")
      expect(detail).toContain("queryParamKey: 'extraQ'")
      expect(detail).toContain("pageParamKey: 'extraPage'")
      expect(detail).toContain("label: 'Additional fields', count: extras.total")
    }

    for (const prefix of ['skillExtra', 'typeExtra', 'authorityExtra']) {
      expect(assignment).toContain(`parsePrefixedListParams(sp, '${prefix}'`)
      expect(assignment).toContain(`queryParamKey=\"${prefix}Q\"`)
      expect(assignment).toContain(`pageParamKey=\"${prefix}Page\"`)
    }
    expect(assignment).toContain("queryParamKey: 'skillExtraQ'")
    expect(assignment).toContain("pageParamKey: 'skillExtraPage'")
  })
})
