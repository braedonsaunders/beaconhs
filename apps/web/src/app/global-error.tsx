'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{ margin: 0, background: '#f8fafc', color: '#0f172a', fontFamily: 'sans-serif' }}
      >
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
        >
          <section
            role="alert"
            aria-labelledby="global-error-title"
            style={{
              width: '100%',
              maxWidth: '30rem',
              boxSizing: 'border-box',
              border: '1px solid #fecaca',
              borderRadius: '0.75rem',
              background: '#fff',
              padding: '1.5rem',
              textAlign: 'center',
            }}
          >
            <h1 id="global-error-title" style={{ margin: 0, fontSize: '1.25rem' }}>
              <GeneratedText id="m_0447981ecb39ff" />
            </h1>
            <p style={{ margin: '0.75rem 0 0', color: '#475569', lineHeight: 1.5 }}>
              <GeneratedText id="m_12d819d902c9ab" />
            </p>
            <GeneratedValue
              value={
                error.digest ? (
                  <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    <GeneratedText id="m_0d0ba851d7848c" /> <GeneratedValue value={error.digest} />
                  </p>
                ) : null
              }
            />
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: '1.25rem',
                border: 0,
                borderRadius: '0.5rem',
                background: '#0f766e',
                color: '#fff',
                cursor: 'pointer',
                font: 'inherit',
                fontWeight: 600,
                padding: '0.65rem 1rem',
              }}
            >
              <GeneratedText id="m_02941fb09831c6" />
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
