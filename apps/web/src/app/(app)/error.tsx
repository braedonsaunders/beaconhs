'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@beaconhs/ui'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="grid min-h-[60vh] place-items-center px-4 py-12">
      <section
        className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/70 dark:bg-slate-900"
        role="alert"
        aria-labelledby="app-error-title"
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <AlertTriangle aria-hidden="true" size={24} />
        </span>
        <h1
          id="app-error-title"
          className="mt-4 text-xl font-semibold text-slate-950 dark:text-white"
        >
          <GeneratedText id="m_00a758ce0c3bab" />
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_08861ac415cc7a" />
        </p>
        <GeneratedValue
          value={
            error.digest ? (
              <p className="mt-3 font-mono text-xs text-slate-400">
                <GeneratedText id="m_0d0ba851d7848c" /> <GeneratedValue value={error.digest} />
              </p>
            ) : null
          }
        />
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" size={15} /> <GeneratedText id="m_02941fb09831c6" />
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">
              <GeneratedText id="m_132d746a8ad9a0" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
