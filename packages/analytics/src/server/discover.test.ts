import { describe, expect, it } from 'vitest'
import { discoverEntityMap } from './discover'

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
})
