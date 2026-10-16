import { registerBrowserDiagnostics } from './lib/browser-diagnostics'
import { installDeploymentGuard } from './lib/deployment-guard'
import * as Sentry from '@sentry/nextjs'

registerBrowserDiagnostics()

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

try {
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.02,
  })
} catch {
  // Optional third-party monitoring must not disable local crash diagnostics.
}

export const onRouterTransitionStart = (
  ...args: Parameters<typeof Sentry.captureRouterTransitionStart>
) => {
  try {
    return Sentry.captureRouterTransitionStart(...args)
  } catch {
    // Navigation must continue if optional monitoring is unavailable.
  }
}

installDeploymentGuard()
