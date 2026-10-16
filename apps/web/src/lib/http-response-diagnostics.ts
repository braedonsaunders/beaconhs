import { channel } from 'node:diagnostics_channel'
import { IncomingMessage, ServerResponse } from 'node:http'
import { performance } from 'node:perf_hooks'
import { beginDiagnosticRequest, diagnosticIdentity } from './diagnostic-context'
import { emitDiagnostic } from './diagnostic-safety'

const registered = Symbol.for('beaconhs.http-response-diagnostics')

export function observeHttpResponse(request: IncomingMessage, response: ServerResponse): void {
  const startedAt = performance.now()
  const context = beginDiagnosticRequest(request, response)
  const prefetch =
    request.headers['next-router-prefetch'] === '1' || request.headers.purpose === 'prefetch'
  response.once('close', () => {
    const durationMs = Math.round(performance.now() - startedAt)
    const completed = response.writableFinished
    const actionFailed = context.actionClass === 'server_action' && response.statusCode >= 400
    if (completed && response.statusCode < 500 && !actionFailed && durationMs < 3_000) return
    const cancelled = !completed && (request.aborted || prefetch)
    emitDiagnostic(
      {
        event: 'http_response',
        ...diagnosticIdentity(context),
        kind: cancelled ? 'request_cancelled' : actionFailed ? 'server_action_failed' : 'response',
        routeFamily: context.routeFamily,
        actionClass: context.actionClass,
        method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(request.method ?? '')
          ? request.method
          : 'OTHER',
        statusCode: response.headersSent ? response.statusCode : null,
        completed,
        requestAborted: request.aborted,
        prefetch,
        durationMs,
        release: process.env.APP_VERSION ?? process.env.DEPLOYMENT_VERSION,
      },
      cancelled ? 'info' : 'warn',
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
      try {
        observeHttpResponse(request, response)
      } catch {
        // Never let an optional diagnostic subscriber crash the HTTP server.
      }
    }
  })
}
