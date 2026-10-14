import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { buildOpenApiDocument } = await import('./openapi')

type Operation = {
  'x-beaconhs-required-permission'?: string
  parameters?: Array<{ name: string; in: string; required?: boolean }>
}

describe('AI briefs public API contract', () => {
  const doc = buildOpenApiDocument('https://example.test') as {
    paths: Record<string, Record<string, Operation>>
    components: { schemas: Record<string, unknown> }
  }

  it('documents every brief route with its permission', () => {
    expect(doc.paths['/api/v1/briefs']?.get?.['x-beaconhs-required-permission']).toBe('briefs.read')
    expect(doc.paths['/api/v1/briefs/{briefId}']?.get?.['x-beaconhs-required-permission']).toBe(
      'briefs.read',
    )
    expect(
      doc.paths['/api/v1/briefs/{briefId}/runs']?.get?.['x-beaconhs-required-permission'],
    ).toBe('briefs.read')
    expect(
      doc.paths['/api/v1/briefs/{briefId}/runs/{runId}']?.get?.['x-beaconhs-required-permission'],
    ).toBe('briefs.read')
  })

  it('makes generation a manage-gated idempotent write', () => {
    const post = doc.paths['/api/v1/briefs/{briefId}/runs']?.post
    expect(post?.['x-beaconhs-required-permission']).toBe('briefs.manage')
    expect(
      post?.parameters?.some(
        (p) => p.name === 'Idempotency-Key' && p.in === 'header' && p.required,
      ),
    ).toBe(true)
    for (const schema of ['Brief', 'BriefRun', 'BriefRunSummary', 'BriefGenerateRequest']) {
      expect(doc.components.schemas[schema], schema).toBeDefined()
    }
  })
})
