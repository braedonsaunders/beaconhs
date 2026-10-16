import type { Instrumentation } from 'next'
import { diagnosticContext, diagnosticIdentity } from './diagnostic-context'
import { routeFamily, safeDigest, safeErrorType } from './diagnostic-safety'

/** Keep module context without URL queries, headers, SQL or user content. */
export function requestErrorDiagnostic(
  error: unknown,
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2],
) {
  const closedStream =
    error instanceof Error && error.message === 'The destination stream closed early.'
  const cancelled = error instanceof Error && error.name === 'AbortError'
  const digest = error && typeof error === 'object' && 'digest' in error ? error.digest : undefined
  return {
    event: 'request_error',
    ...diagnosticIdentity(diagnosticContext(request.headers)),
    kind: closedStream
      ? 'response_stream_closed'
      : cancelled
        ? 'request_cancelled'
        : 'request_failed',
    routeFamily: routeFamily(context.routePath),
    method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(request.method)
      ? request.method
      : 'OTHER',
    routeType: context.routeType,
    renderSource: context.renderSource,
    errorType: safeErrorType(error instanceof Error ? error.name : undefined),
    digest: safeDigest(digest),
    release: process.env.APP_VERSION ?? process.env.DEPLOYMENT_VERSION,
  }
}
