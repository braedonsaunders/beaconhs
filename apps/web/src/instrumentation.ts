import * as Sentry from '@sentry/nextjs'
import type { Instrumentation } from 'next'
import { requestErrorDiagnostic } from './lib/request-error-diagnostics'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    const { registerHttpResponseDiagnostics } = await import('./lib/http-response-diagnostics')
    registerHttpResponseDiagnostics()
  }
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config')
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(JSON.stringify(requestErrorDiagnostic(error, request, context)))
  return Sentry.captureRequestError(error, request, context)
}
