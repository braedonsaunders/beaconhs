import { beforeEach, describe, expect, it, vi } from 'vitest'

const headersMock = vi.fn()
vi.mock('next/headers', () => ({ headers: headersMock }))

describe('API reference document', () => {
  beforeEach(() => {
    headersMock.mockResolvedValue(new Headers({ 'x-nonce': '0123456789abcdef0123456789abcdef' }))
  })

  it('loads an exact, integrity-pinned Scalar artifact with the request nonce', async () => {
    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.text()

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toContain(
      'src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5/dist/browser/standalone.js"',
    )
    expect(body).toContain(
      'integrity="sha384-qgSpG+a6nhdzdIVlaUPfNI6jwGGnmHPTGC2JXXgWBjPMTSDI4hcdVQzagOL6ZKLm"',
    )
    expect(body).toContain('crossorigin="anonymous"')
    expect(body).toContain('referrerpolicy="no-referrer"')
    expect(body.match(/nonce="0123456789abcdef0123456789abcdef"/g)).toHaveLength(3)
    expect(body).not.toContain('src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"')
  })
})
