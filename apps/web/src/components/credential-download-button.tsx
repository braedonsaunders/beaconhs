'use client'

// Download button for on-demand credential PDFs (certificate / wallet card).
// The route renders fresh PDF bytes on every request, so template/design
// changes are reflected immediately and no generated artifact needs cleanup.

import * as React from 'react'
import { Button, type ButtonProps } from '@beaconhs/ui'

export function CredentialDownloadButton({
  endpoint,
  format,
  children,
  pendingLabel: _pendingLabel,
  ...buttonProps
}: {
  endpoint: string
  format: 'cert' | 'wallet'
  children: React.ReactNode
  pendingLabel?: string
} & Omit<ButtonProps, 'onClick' | 'asChild'>) {
  function handleClick() {
    const url = `${endpoint}?format=${format}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Button {...buttonProps} onClick={handleClick}>
      {children}
    </Button>
  )
}
