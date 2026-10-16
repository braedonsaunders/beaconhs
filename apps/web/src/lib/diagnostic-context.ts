import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RequestContext } from '@beaconhs/tenant'
import { browserCategory, routeFamily } from './diagnostic-safety'

export const DIAGNOSTIC_REQUEST_HEADER = 'x-beaconhs-request-id'
const stateKey = Symbol.for('beaconhs.diagnostic-requests')
type DiagnosticContext = {
  requestId: string
  actorUserId?: string
  actorKind?: 'user' | 'api_key'
  apiKeyId?: string
  effectiveUserId?: string
  tenantId?: string
  actorIp?: string
  actorUserAgent?: string
  browser: ReturnType<typeof browserCategory>
  routeFamily: string
  actionClass: 'server_action' | 'request'
}
const root = globalThis as typeof globalThis & {
  [stateKey]?: Map<string, DiagnosticContext>
}
const requests = (root[stateKey] ??= new Map())
type HeaderSource = { get(name: string): string | null } | Record<string, unknown>

function header(source: HeaderSource, name: string): string | undefined {
  const value =
    typeof source.get === 'function' ? source.get(name) : (source as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

/** The observer overwrites external IDs before Next sees the request. Only IDs
 * in this live map are accepted. A map bridges Next's separate request stores
 * without enterWith() leaking an identity into another HTTP request. */
export function beginDiagnosticRequest(request: IncomingMessage, response: ServerResponse) {
  const requestId = randomUUID()
  request.headers[DIAGNOSTIC_REQUEST_HEADER] = requestId
  response.setHeader(DIAGNOSTIC_REQUEST_HEADER, requestId)
  const userAgent = request.headers['user-agent']
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 256)
  const peer = request.socket.remoteAddress
  const context: DiagnosticContext = {
    requestId,
    actorIp: peer && isIP(peer) ? peer : undefined,
    actorUserAgent: userAgent,
    browser: browserCategory(userAgent ?? ''),
    routeFamily: routeFamily(request.url ?? ''),
    actionClass: request.headers['next-action'] ? 'server_action' : 'request',
  }
  // Bound memory even if a client holds requests open indefinitely. Existing
  // response closures retain their own context; evicted requests lose attribution.
  if (requests.size >= 10_000) requests.delete(requests.keys().next().value!)
  requests.set(requestId, context)
  const cleanup = () => requests.delete(requestId)
  response.once('close', cleanup)
  response.once('finish', cleanup)
  return context
}

export function diagnosticContext(headers: HeaderSource): DiagnosticContext | undefined {
  const id = header(headers, DIAGNOSTIC_REQUEST_HEADER)
  return id ? requests.get(id) : undefined
}

export function annotateDiagnosticActor(headers: HeaderSource, actorUserId: string) {
  const context = diagnosticContext(headers)
  if (context) {
    context.actorUserId = actorUserId
    context.actorKind = 'user'
  }
}

export function annotateDiagnosticContext(headers: HeaderSource, ctx: RequestContext) {
  const context = diagnosticContext(headers)
  if (!context) return
  context.actorUserId = ctx.impersonation?.actor.userId ?? ctx.userId
  context.actorKind = ctx.apiKey ? 'api_key' : 'user'
  context.apiKeyId = ctx.apiKey?.id
  context.effectiveUserId = ctx.userId
  context.tenantId = ctx.tenantId
}

export function diagnosticIdentity(context: DiagnosticContext | undefined) {
  return context
    ? {
        requestId: context.requestId,
        actorUserId: context.actorUserId,
        actorKind: context.actorKind,
        apiKeyId: context.apiKeyId,
        effectiveUserId: context.effectiveUserId,
        tenantId: context.tenantId,
        browser: context.browser,
      }
    : {}
}
