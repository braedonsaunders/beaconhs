import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0.02,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
