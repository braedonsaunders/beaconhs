import { z } from 'zod'
import { consumeRateLimit } from '@beaconhs/jobs/rate-limit'
import { getRequestContext } from '@/lib/auth'
import { diagnosticContext, diagnosticIdentity } from '@/lib/diagnostic-context'
import { readBoundedJsonBody } from '@/lib/request-body'
import { appBaseUrl } from '@/lib/app-base-url'
import {
  DIAGNOSTIC_ROUTE_FAMILIES,
  DIAGNOSTIC_ERROR_TYPES,
  browserCategory,
  emitDiagnostic,
} from '@/lib/diagnostic-safety'

export const runtime = 'nodejs'
const MAX_BYTES = 4096
const schema = z
  .object({
    kind: z.enum([
      'unhandled_error',
      'unhandled_rejection',
      'react_boundary',
      'deployment_stale',
      'smoke',
      'event_loop_delay',
    ]),
    routeFamily: z.enum(DIAGNOSTIC_ROUTE_FAMILIES),
    deviceId: z.uuid(),
    clientRelease: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    errorType: z.enum(DIAGNOSTIC_ERROR_TYPES),
    digest: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    positions: z
      .array(
        z
          .string()
          .max(240)
          .regex(/^\/_next\/static\/[a-zA-Z0-9_./-]+\.js:\d{1,7}:\d{1,7}$/)
          .refine((value) => !value.includes('..')),
      )
      .max(5),
    delayMs: z.number().int().min(3_000).max(30_000).optional(),
    reason: z.enum(['version_mismatch', 'action_not_found']).optional(),
  })
  .strict()
  .refine((event) =>
    event.kind === 'event_loop_delay' ? event.delayMs !== undefined : event.delayMs === undefined,
  )

export async function POST(request: Request) {
  // Standalone Next may reconstruct an internal container URL. Use the configured
  // public origin; never trust a forwarded host or a client-supplied actor ID.
  const origin = request.headers.get('origin')
  let expectedOrigin
  try {
    expectedOrigin = new URL(appBaseUrl()).origin
  } catch {
    return new Response(null, { status: 503 })
  }
  if (
    !origin ||
    origin !== expectedOrigin ||
    (request.headers.get('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  ) {
    return new Response(null, { status: 403 })
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    return new Response(null, { status: 415 })
  }
  try {
    const ctx = await getRequestContext()
    if (!ctx) return new Response(null, { status: 401 })
    const rate = await consumeRateLimit({
      key: `browser-diagnostics:${ctx.tenantId}:${ctx.impersonation?.actor.userId ?? ctx.userId}`,
      limit: 30,
      windowSeconds: 60,
    })
    if (!rate.allowed) return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    let body
    try {
      body = schema.safeParse(
        await readBoundedJsonBody(request, { maxBytes: MAX_BYTES, timeoutMs: 10_000 }),
      )
    } catch {
      return new Response(null, { status: 400 })
    }
    if (!body.success) return new Response(null, { status: 400 })
    // The client describes the event only. Attribution always comes from the
    // authenticated server context; deviceId is a random correlation hint.
    const logged = emitDiagnostic(
      {
        event: 'browser_diagnostic',
        ...body.data,
        ...diagnosticIdentity(diagnosticContext(request.headers)),
        actorUserId: ctx.impersonation?.actor.userId ?? ctx.userId,
        effectiveUserId: ctx.userId,
        tenantId: ctx.tenantId,
        browser: browserCategory(request.headers.get('user-agent') ?? ''),
        release: process.env.APP_VERSION ?? process.env.DEPLOYMENT_VERSION,
      },
      body.data.kind === 'smoke' ||
        body.data.kind === 'deployment_stale' ||
        body.data.kind === 'event_loop_delay'
        ? 'info'
        : 'error',
    )
    return new Response(null, {
      status: logged ? 204 : 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    // This route is optional telemetry. Redis/auth failures do not become
    // application failures, and no exception text or request body is logged.
    return new Response(null, { status: 503 })
  }
}
