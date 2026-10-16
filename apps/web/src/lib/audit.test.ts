import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { beginDiagnosticRequest } from './diagnostic-context'

const requestHeaders = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.headers }))
beforeEach(() => {
  requestHeaders.headers = new Headers()
})
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from './audit'

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: 'user_1',
    tenantId: '10000000-0000-4000-8000-000000000001',
    isSuperAdmin: false,
    timezone: 'America/Toronto',
    locale: 'en',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    localeOverride: null,
    membership: null,
    personId: null,
    permissions: new Set(),
    scopes: [],
    db: async () => {
      throw new Error('recordAuditInTransaction must use the supplied transaction')
    },
    ...overrides,
  }
}

function transactionCapture() {
  let values: Record<string, unknown> | undefined
  let conflictTarget: unknown
  const terminal = Promise.resolve()
  const tx = {
    insert: () => ({
      values: (next: Record<string, unknown>) => {
        values = next
        return {
          then: terminal.then.bind(terminal),
          onConflictDoNothing: (options: { target: unknown }) => {
            conflictTarget = options.target
            return terminal
          },
        }
      },
    }),
  } as unknown as Database
  return {
    tx,
    captured: () => ({ values, conflictTarget }),
  }
}

describe('recordAuditInTransaction', () => {
  it('writes through the supplied transaction with the ordinary actor', async () => {
    const capture = transactionCapture()

    await recordAuditInTransaction(capture.tx, context(), {
      entityType: 'api_key',
      entityId: '20000000-0000-4000-8000-000000000001',
      action: 'update',
      summary: 'Updated key',
      metadata: { reason: 'rotation' },
    })

    expect(capture.captured().values).toMatchObject({
      tenantId: '10000000-0000-4000-8000-000000000001',
      actorUserId: 'user_1',
      entityType: 'api_key',
      action: 'update',
      summary: 'Updated key',
      metadata: { reason: 'rotation' },
    })
  })

  it('preserves API-key and impersonation attribution', async () => {
    const capture = transactionCapture()
    const ctx = context({
      userId: 'api_key:key_1',
      apiKey: { id: 'key_1', name: 'Integration' },
      impersonation: {
        actor: { userId: 'admin_1', name: 'Admin User', email: 'admin@example.com' },
        tenantId: '10000000-0000-4000-8000-000000000001',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    })

    await recordAuditInTransaction(capture.tx, ctx, {
      entityType: 'record',
      action: 'create',
      summary: 'Created record',
      metadata: { source: 'test' },
    })

    expect(capture.captured().values).toMatchObject({
      actorUserId: null,
      summary: '[impersonated] Created record',
      metadata: {
        source: 'test',
        actorKind: 'api_key',
        apiKeyId: 'key_1',
        apiKeyName: 'Integration',
        impersonatorUserId: 'admin_1',
        impersonatorName: 'Admin User',
      },
    })
  })

  it('uses the tenant-scoped deduplication key when one is supplied', async () => {
    const capture = transactionCapture()

    await recordAuditInTransaction(capture.tx, context(), {
      entityType: 'training_skill',
      action: 'create',
      dedupKey: 'training-skill-renew:source-id',
    })

    expect(capture.captured().values).toMatchObject({
      dedupKey: 'training-skill-renew:source-id',
    })
    expect(capture.captured().conflictTarget).toBeDefined()
  })
})

it('enriches audit rows only with server-minted request metadata and a verified socket peer', async () => {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: '10.20.30.40' })
  const request = new IncomingMessage(socket)
  request.headers = { 'user-agent': 'Safari/123', 'x-forwarded-for': 'forged-ip' }
  const response = new ServerResponse(request)
  const diagnostic = beginDiagnosticRequest(request, response)
  requestHeaders.headers = new Headers({ 'x-beaconhs-request-id': diagnostic.requestId })
  const capture = transactionCapture()
  await recordAuditInTransaction(capture.tx, context(), {
    entityType: 'journal',
    action: 'update',
    metadata: { requestId: 'forged' },
  })
  expect(capture.captured().values).toMatchObject({
    actorIp: '10.20.30.40',
    actorUserAgent: 'Safari/123',
    metadata: { requestId: diagnostic.requestId, actorIpSource: 'socket-peer', browser: 'safari' },
  })
  response.emit('close')
  request.destroy()
  const afterClose = transactionCapture()
  await recordAuditInTransaction(afterClose.tx, context(), {
    entityType: 'journal',
    action: 'update',
  })
  expect(afterClose.captured().values?.actorIp).toBeUndefined()
  expect(afterClose.captured().values?.metadata).toEqual({})
})
