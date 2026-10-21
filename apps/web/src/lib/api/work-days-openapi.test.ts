import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { buildOpenApiDocument } = await import('./openapi')
type Operation = { 'x-beaconhs-required-permission'?: string }
const doc = buildOpenApiDocument('https://example.test') as {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, { properties: Record<string, { type: string }> }> }
}
describe('optional provider-neutral work-day API', () => {
  it('documents separate read/write permissions, upsert and removal', () => {
    expect(doc.paths['/api/v1/person_work_days']?.get?.['x-beaconhs-required-permission']).toBe(
      'compliance.read',
    )
    expect(doc.paths['/api/v1/person_work_days']?.post?.['x-beaconhs-required-permission']).toBe(
      'compliance.manage',
    )
    expect(
      doc.paths['/api/v1/person_work_days/{id}']?.delete?.['x-beaconhs-required-permission'],
    ).toBe('compliance.manage')
  })
  it('describes worked decisions as booleans rather than strings', () => {
    expect(doc.components.schemas.PersonWorkDays?.properties.worked?.type).toBe('boolean')
  })
})
