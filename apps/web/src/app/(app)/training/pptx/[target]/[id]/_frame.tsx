'use client'

// Collabora editor embed: WOPI mandates the access token travel as a form POST
// into the iframe (never in the URL), so this auto-submits a hidden form
// targeting the frame on mount.

import { useEffect, useRef } from 'react'

export function CollaboraFrame({
  actionUrl,
  accessToken,
  accessTokenTtl,
}: {
  actionUrl: string
  accessToken: string
  /** Token expiry, ms since epoch (WOPI access_token_ttl semantics). */
  accessTokenTtl: number
}) {
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.submit()
  }, [])

  return (
    <div className="min-h-0 flex-1">
      <form
        ref={formRef}
        action={actionUrl}
        method="POST"
        target="collabora-editor"
        className="hidden"
      >
        <input type="hidden" name="access_token" value={accessToken} readOnly />
        <input type="hidden" name="access_token_ttl" value={String(accessTokenTtl)} readOnly />
      </form>
      <iframe
        name="collabora-editor"
        title="PowerPoint editor"
        className="h-full w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        allow="clipboard-read *; clipboard-write *; fullscreen *"
        allowFullScreen
      />
    </div>
  )
}
