'use client'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Button, SignaturePad as CanvasSignaturePad } from '@beaconhs/ui'
import { GeneratedValue } from '@/i18n/generated'
import { getMySavedSignatureCapture } from '@/lib/saved-signature-actions'

/** The canvas stays canonical; reuse must be explicitly enabled for a known signer. */
export function SignaturePad({
  reuseOwnSignature = false,
  signerPersonId,
  ...props
}: ComponentProps<typeof CanvasSignaturePad> & {
  reuseOwnSignature?: boolean
  /** Required for a picker/crew slot; the server refuses another person's id. */
  signerPersonId?: string
}) {
  const { value, disabled, onChange } = props
  const [loaded, setLoaded] = useState<{
    signerPersonId?: string
    value: Awaited<ReturnType<typeof getMySavedSignatureCapture>>
  } | null>(null)
  const saved =
    reuseOwnSignature && loaded?.signerPersonId === signerPersonId ? loaded?.value : null
  const [error, setError] = useState(false)
  const applied = useRef(false)
  useEffect(() => {
    if (!reuseOwnSignature) return
    let cancelled = false
    void getMySavedSignatureCapture(signerPersonId)
      .then((value) => {
        if (!cancelled) setLoaded({ signerPersonId, value })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reuseOwnSignature, signerPersonId])
  useEffect(() => {
    if (value) applied.current = true
    if (applied.current || disabled || saved?.mode !== 'automatic') return
    applied.current = true
    onChange(saved.dataUrl)
  }, [value, disabled, onChange, saved])
  if (!reuseOwnSignature) return <CanvasSignaturePad {...props} />
  return (
    <div
      className="space-y-2"
      onPointerDownCapture={() => {
        // A slow saved-image request must never overwrite a stroke in progress.
        applied.current = true
      }}
    >
      {reuseOwnSignature && !props.disabled && !props.value && saved ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            applied.current = true
            props.onChange(saved.dataUrl)
          }}
        >
          <GeneratedValue value="Use my saved signature" />
        </Button>
      ) : null}
      <CanvasSignaturePad {...props} />
      {error ? (
        <p role="alert" className="text-sm text-amber-700">
          <GeneratedValue value="Could not load your saved signature. You can still draw it here." />
        </p>
      ) : null}
    </div>
  )
}
