'use client'

// Download button for worker-rendered credential PDFs (certificate / wallet
// card). The GET route returns { status: 'ready', url } once a PDF exists, or
// { status: 'pending' } after enqueueing a render — so the first click on a
// fresh record kicks off the render and this button polls until the file is
// ready, then opens it.
//
// The tab is opened synchronously on click (before any await) so popup
// blockers see a user gesture, and pointed at the signed URL when it arrives.

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, type ButtonProps } from '@beaconhs/ui'

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS = 90_000

export function CredentialDownloadButton({
  endpoint,
  format,
  children,
  pendingLabel = 'Generating…',
  ...buttonProps
}: {
  endpoint: string
  format: 'cert' | 'wallet'
  children: React.ReactNode
  pendingLabel?: string
} & Omit<ButtonProps, 'onClick' | 'asChild'>) {
  const [busy, setBusy] = React.useState(false)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    const tab = window.open('', '_blank')
    if (tab) {
      tab.document.write(
        '<p style="font-family:system-ui,sans-serif;color:#334155;padding:24px;">Generating PDF…</p>',
      )
    }
    try {
      const url = `${endpoint}?format=${format}&json=1`
      const deadline = Date.now() + POLL_TIMEOUT_MS
      let announcedPending = false
      for (;;) {
        const res = await fetch(url, { cache: 'no-store' })
        const body = (await res.json().catch(() => null)) as {
          status?: string
          url?: string
          error?: string
        } | null
        if (!res.ok) {
          throw new Error(body?.error ?? `Request failed (${res.status})`)
        }
        if (body?.status === 'ready' && body.url) {
          if (tab) tab.location.replace(body.url)
          else window.location.href = body.url
          return
        }
        if (!announcedPending) {
          toast.info('Generating PDF — this usually takes a few seconds.')
          announcedPending = true
        }
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for the PDF render. Try again in a moment.')
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    } catch (err) {
      tab?.close()
      toast.error(err instanceof Error ? err.message : 'Failed to generate the PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button {...buttonProps} onClick={handleClick} disabled={busy || buttonProps.disabled}>
      {busy ? (
        <>
          <Loader2 size={14} className="animate-spin" /> {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
