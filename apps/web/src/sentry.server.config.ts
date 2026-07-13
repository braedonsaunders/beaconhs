import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
})
