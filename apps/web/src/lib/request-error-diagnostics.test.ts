import { describe, expect, it } from 'vitest'
import { requestErrorDiagnostic } from './request-error-diagnostics'

const request = {
  path: '/journals/private-id?token=secret',
  method: 'POST',
  headers: { cookie: 'secret' },
}
const context = {
  routerKind: 'App Router',
  routePath: '/journals/[id]',
  routeType: 'action',
  revalidateReason: undefined,
} as const

describe('request error diagnostics', () => {
  it('classifies a closed render stream without treating every failure as cancellation', () => {
    expect(
      requestErrorDiagnostic(new Error('The destination stream closed early.'), request, context),
    ).toMatchObject({
      kind: 'response_stream_closed',
      route: '/journals/[id]',
      method: 'POST',
    })
    expect(requestErrorDiagnostic(new Error('Database failed'), request, context).kind).toBe(
      'request_failed',
    )
  })
  it('excludes request contents, headers, arbitrary error text and unsafe digests', () => {
    const error = Object.assign(new Error('secret SQL and document contents'), {
      digest: 'secret\nSQL',
    })
    const diagnostic = requestErrorDiagnostic(error, request, {
      ...context,
      routePath: '/journals/[id]?secret',
    })
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|private-id|cookie|SQL/)
    expect(diagnostic.digest).toBeUndefined()
    expect(requestErrorDiagnostic({ digest: '3917090666' }, request, context).digest).toBe(
      '3917090666',
    )
  })
})
