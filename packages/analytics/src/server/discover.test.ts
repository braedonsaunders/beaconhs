import { describe, expect, it } from 'vitest'
import { discoverEntities, discoverEntityMap } from './discover'

describe('analytics relationship discovery', () => {
  it('discovers tenant-preserving composite foreign keys by their business column', () => {
    const incidentRelations = discoverEntityMap().incidents?.relations ?? []

    expect(incidentRelations).toContainEqual({
      via: 'site_org_unit_id',
      target: 'org_units',
      foreignColumn: 'id',
      label: 'Site org unit',
    })
  })

  it('keeps ordinary single-column relationships discoverable', () => {
    const trainingRelations = discoverEntityMap().training_records?.relations ?? []

    expect(trainingRelations).toContainEqual({
      via: 'course_id',
      target: 'training_courses',
      foreignColumn: 'id',
      label: 'Course',
    })
  })

  it('never exposes tenant_id itself as a relation path', () => {
    for (const entity of Object.values(discoverEntityMap())) {
      expect(entity.relations?.some(({ via }) => via === 'tenant_id') ?? false, entity.key).toBe(
        false,
      )
    }
  })

  it('does not expose API credential or idempotency infrastructure as business data', () => {
    const keys = discoverEntities().map((entity) => entity.key)

    expect(keys).not.toContain('api_keys')
    expect(keys).not.toContain('api_idempotency_keys')
  })
})
