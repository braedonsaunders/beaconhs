import { channel } from 'node:diagnostics_channel'
import { IncomingMessage, ServerResponse } from 'node:http'
import { performance } from 'node:perf_hooks'

const registered = Symbol.for('beaconhs.http-response-diagnostics')
const routeFamilies = new Set([
  'journals',
  'equipment',
  'inspections',
  'hazard-assessments',
  'training',
  'corrective-actions',
  'people',
  'documents',
  'ppe',
  'api',
  'login',
  'admin',
  'reports',
  'dashboard',
  'forms',
  'help',
])

export function observeHttpResponse(request: IncomingMessage, response: ServerResponse): void {
  const startedAt = performance.now()
  // Only a known module name is retained; never query strings, IDs or free text.
  const firstSegment = request.url?.split('?')[0]?.split('/')[1] ?? ''
  const routeFamily = routeFamilies.has(firstSegment) ? firstSegment : 'other'
  response.once('close', () => {
    const durationMs = Math.round(performance.now() - startedAt)
    const completed = response.writableFinished
    if (completed && response.statusCode < 500 && durationMs < 3_000) return
    console.warn(
      JSON.stringify({
        event: 'http_response',
        routeFamily,
        method: request.method,
        statusCode: response.headersSent ? response.statusCode : null,
        completed,
        requestAborted: request.aborted,
        durationMs,
        release: process.env.APP_VERSION ?? process.env.DEPLOYMENT_VERSION,
      }),
    )
  })
}

export function registerHttpResponseDiagnostics(): void {
  const state = globalThis as typeof globalThis & { [registered]?: boolean }
  if (state[registered]) return
  state[registered] = true
  channel('http.server.request.start').subscribe((message) => {
    const { request, response } = message as { request?: unknown; response?: unknown }
    if (request instanceof IncomingMessage && response instanceof ServerResponse) {
      observeHttpResponse(request, response)
    }
  })
}
