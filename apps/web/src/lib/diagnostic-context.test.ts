import { IncomingMessage, ServerResponse, createServer } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import {
  annotateDiagnosticActor,
  annotateDiagnosticContext,
  beginDiagnosticRequest,
  diagnosticContext,
  diagnosticIdentity,
  DIAGNOSTIC_REQUEST_HEADER,
} from './diagnostic-context'
import { emitDiagnostic } from './diagnostic-safety'

afterEach(() => vi.restoreAllMocks())

describe('request identity bridge', () => {
  it('isolates overlapping requests and removes identity at response completion', async () => {
    const seen: object[] = []
    const server = createServer(async (req, res) => {
      beginDiagnosticRequest(req, res)
      const actor = req.url === '/first' ? 'peter' : 'other-user'
      annotateDiagnosticActor(req.headers, actor)
      annotateDiagnosticContext(req.headers, {
        userId: actor,
        tenantId: `${actor}-tenant`,
      } as RequestContext)
      await new Promise((resolve) => setTimeout(resolve, actor === 'peter' ? 30 : 1))
      const context = diagnosticContext(req.headers)
      seen.push(diagnosticIdentity(context))
      res.end(JSON.stringify({ actor: context?.actorUserId, requestId: context?.requestId }))
      res.once('close', () => expect(diagnosticContext(req.headers)).toBeUndefined())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server')
      const base = `http://127.0.0.1:${address.port}`
      const rows = await Promise.all(
        ['/first', '/second'].map(async (path) => {
          const response = await fetch(base + path, {
            headers: { [DIAGNOSTIC_REQUEST_HEADER]: 'forged-id' },
          })
          return response.json() as Promise<{ actor: string; requestId: string }>
        }),
      )
      expect(rows.map((row) => row.actor)).toEqual(['peter', 'other-user'])
      expect(new Set(rows.map((row) => row.requestId)).size).toBe(2)
      expect(rows.some((row) => row.requestId === 'forged-id')).toBe(false)
      expect(seen).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actorUserId: 'peter', tenantId: 'peter-tenant' }),
          expect.objectContaining({ actorUserId: 'other-user', tenantId: 'other-user-tenant' }),
        ]),
      )
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  it('keeps real and effective actors distinct and never trusts forwarded IPs', () => {
    const request = new IncomingMessage(new Socket())
    request.headers = { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Chrome/123\nunsafe' }
    const response = new ServerResponse(request)
    beginDiagnosticRequest(request, response)
    annotateDiagnosticContext(request.headers, {
      userId: 'effective',
      tenantId: 'tenant',
      impersonation: { actor: { userId: 'real-actor' } },
    } as RequestContext)
    expect(diagnosticContext(request.headers)).toMatchObject({
      actorUserId: 'real-actor',
      effectiveUserId: 'effective',
      tenantId: 'tenant',
      actorUserAgent: 'Chrome/123unsafe',
      browser: 'chrome',
    })
    expect(diagnosticContext(request.headers)?.actorIp).toBeUndefined()
    response.emit('close')
    request.destroy()
  })

  it('does not throw if the logging sink fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('broken sink')
    })
    expect(() => emitDiagnostic({ event: 'test' }, 'error')).not.toThrow()
  })
})

it('marks an API-key actor explicitly without logging a key secret or name', () => {
  const request = new IncomingMessage(new Socket())
  const response = new ServerResponse(request)
  beginDiagnosticRequest(request, response)
  annotateDiagnosticContext(request.headers, {
    userId: 'key-owner',
    tenantId: 'tenant',
    apiKey: { id: 'key-id', name: 'private key label' },
  } as RequestContext)
  const diagnostic = diagnosticIdentity(diagnosticContext(request.headers))
  expect(diagnostic).toMatchObject({
    actorUserId: 'key-owner',
    actorKind: 'api_key',
    apiKeyId: 'key-id',
  })
  expect(JSON.stringify(diagnostic)).not.toContain('private key label')
  response.emit('close')
  request.destroy()
})
