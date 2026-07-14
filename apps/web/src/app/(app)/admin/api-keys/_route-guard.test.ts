import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('API key detail route guard', () => {
  it('rejects malformed UUID route params before querying the UUID column', () => {
    const source = readFileSync(new URL('./[id]/page.tsx', import.meta.url), 'utf8')
    const guard = source.indexOf('if (!isUuid(id)) notFound()')
    const query = source.indexOf('.where(eq(apiKeys.id, id))')
    expect(guard).toBeGreaterThan(-1)
    expect(query).toBeGreaterThan(guard)
  })
})
