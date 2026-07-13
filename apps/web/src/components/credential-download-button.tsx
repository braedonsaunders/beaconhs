'use client'

// Download button for on-demand credential PDFs (certificate / wallet card).
// The route renders fresh PDF bytes on every request, so template/design
// changes are reflected immediately and no generated artifact needs cleanup.

import * as React from 'react'
import { Button, type ButtonProps } from '@beaconhs/ui'

export function CredentialDownloadButton({
  endpoint,
  outputId,
  action = 'open',
  children,
  pendingLabel: _pendingLabel,
  ...buttonProps
}: {
  endpoint: string
  outputId?: string
  action?: 'open' | 'print'
  children: React.ReactNode
  pendingLabel?: string
} & Omit<ButtonProps, 'onClick' | 'asChild'>) {
  function credentialUrl() {
    const url = new URL(endpoint, window.location.origin)
    if (outputId) url.searchParams.set('output', outputId)
    return url
  }

  function handleClick() {
    const url = credentialUrl()
    if (action === 'print') {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.src = url.toString()
      iframe.onload = () => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        window.setTimeout(() => iframe.remove(), 30_000)
      }
      document.body.appendChild(iframe)
      return
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  return (
    <Button {...buttonProps} onClick={handleClick}>
      {children}
    </Button>
  )
}
