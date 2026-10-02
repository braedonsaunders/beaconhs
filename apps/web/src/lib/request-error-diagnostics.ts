import type { Instrumentation } from 'next'

/** Keep route context without logging URL queries, headers, SQL or user content. */
export function requestErrorDiagnostic(
  error: unknown,
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2],
) {
  const closedStream =
    error instanceof Error && error.message === 'The destination stream closed early.'
  const digest = error && typeof error === 'object' && 'digest' in error ? error.digest : undefined
  return {
    event: 'request_error',
    kind: closedStream ? 'response_stream_closed' : 'request_failed',
    route: context.routePath.split('?')[0]?.slice(0, 240),
    method: request.method.slice(0, 16),
    routeType: context.routeType,
    renderSource: context.renderSource,
    digest: typeof digest === 'string' && /^[\w-]{1,80}$/.test(digest) ? digest : undefined,
    release: process.env.APP_VERSION ?? process.env.DEPLOYMENT_VERSION,
  }
}
