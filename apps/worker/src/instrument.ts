import * as Sentry from '@sentry/node'

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
})

export function captureWorkerFailure(
  error: unknown,
  context: { queue: string; jobId?: string; jobName?: string },
) {
  Sentry.captureException(error, {
    tags: { queue: context.queue },
    contexts: {
      job: {
        id: context.jobId ?? 'unknown',
        name: context.jobName ?? 'unknown',
      },
    },
  })
}

export async function flushObservability(timeoutMs = 2_000) {
  if (dsn) await Sentry.flush(timeoutMs)
}
