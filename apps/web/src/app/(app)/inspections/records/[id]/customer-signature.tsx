'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { RawImage } from '@/components/raw-image'

/**
 * Customer signature capture card — wraps the shared <SignaturePad>, gathers
 * a signer name, and POSTs to the server action via a hidden form.
 *
 * This is a Client Component because <SignaturePad> needs canvas events.
 */
export function CustomerSignatureCard({
  recordId,
  currentSignature,
  currentSignerName,
  signedAt,
  locked,
  saveAction,
}: {
  recordId: string
  currentSignature: string | null
  currentSignerName: string | null
  signedAt: Date | null
  locked: boolean
  saveAction: (fd: FormData) => Promise<void>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [signature, setSignature] = useState<string | null>(currentSignature)
  const [signerName, setSignerName] = useState<string>(currentSignerName ?? '')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function persist() {
    setError(null)
    if (!signature) {
      setError('Capture a signature first.')
      return
    }
    start(async () => {
      const fd = new FormData()
      fd.set('recordId', recordId)
      fd.set('signature', signature)
      fd.set('signerName', signerName)
      try {
        await saveAction(fd)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save signature')
      }
    })
  }

  function clearSignature() {
    setError(null)
    start(async () => {
      const fd = new FormData()
      fd.set('recordId', recordId)
      fd.set('signature', 'clear')
      fd.set('signerName', signerName)
      try {
        await saveAction(fd)
        setSignature(null)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to clear signature')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Customer signature
          {currentSignature ? (
            <Badge variant="success">Captured</Badge>
          ) : (
            <Badge variant="secondary">Not signed</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {locked ? (
          <>
            {currentSignature ? (
              <div className="space-y-1">
                <div className="text-xs tracking-wide text-slate-500 uppercase">
                  Signature (locked)
                </div>
                <RawImage
                  src={currentSignature}
                  alt="Customer signature"
                  optimizationReason="generated"
                  className="max-h-32 rounded border border-slate-200 bg-white"
                />
                <div className="text-xs text-slate-600">
                  {currentSignerName ? `Signed by ${currentSignerName}` : 'Signed'}
                  {signedAt ? ` on ${new Date(signedAt).toLocaleString()}` : ''}
                </div>
              </div>
            ) : (
              <Alert variant="info">
                <AlertTitle>No signature was captured</AlertTitle>
                <AlertDescription>This record was closed without a signature.</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <form ref={formRef} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Signer name</Label>
              <Input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Customer rep on site"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Signature</Label>
              <SignaturePad value={signature} onChange={setSignature} height={160} />
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={persist} disabled={pending}>
                {pending ? 'Saving…' : 'Save signature'}
              </Button>
              {currentSignature ? (
                <Button type="button" variant="outline" onClick={clearSignature} disabled={pending}>
                  Clear stored signature
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
