import * as Sentry from '@sentry/nextjs'
import type { Instrumentation } from 'next'
import { emitDiagnostic } from './lib/diagnostic-safety'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerHttpResponseDiagnostics } = await import('./lib/http-response-diagnostics')
    registerHttpResponseDiagnostics()
  }
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config')
    if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config')
  } catch {
    emitDiagnostic(
      { event: 'monitoring_initialization_failed', runtime: process.env.NEXT_RUNTIME },
      'error',
    )
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { requestErrorDiagnostic } = await import('./lib/request-error-diagnostics')
      const diagnostic = requestErrorDiagnostic(error, request, context)
      emitDiagnostic(diagnostic, diagnostic.kind === 'request_failed' ? 'error' : 'info')
    } catch {
      // Preserve the original application failure if diagnostics are unavailable.
    }
  }
  try {
    return await Sentry.captureRequestError(error, request, context)
  } catch {
    // An optional monitoring service must never break the application.
  }
}
