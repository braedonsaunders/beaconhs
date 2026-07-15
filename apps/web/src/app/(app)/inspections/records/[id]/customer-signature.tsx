'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [signature, setSignature] = useState<string | null>(currentSignature)
  const [signerName, setSignerName] = useState<string>(currentSignerName ?? '')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function persist() {
    setError(tGeneratedValue(null))
    if (!signature) {
      setError(tGenerated('m_1b76abb47cf690'))
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
        setError(tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_0620b9fad73661')))
      }
    })
  }

  function clearSignature() {
    setError(tGeneratedValue(null))
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
        setError(tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_052eecbedaa1a7')))
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GeneratedText id="m_183a4f7e06a053" />
          <GeneratedValue
            value={
              currentSignature ? (
                <Badge variant="success">
                  <GeneratedText id="m_0f5ce595ab8f1d" />
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <GeneratedText id="m_17f941df9401b5" />
                </Badge>
              )
            }
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <GeneratedValue
          value={
            error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  <GeneratedText id="m_0af1983403d12e" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedValue value={error} />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
        <GeneratedValue
          value={
            locked ? (
              <>
                <GeneratedValue
                  value={
                    currentSignature ? (
                      <div className="space-y-1">
                        <div className="text-xs tracking-wide text-slate-500 uppercase">
                          <GeneratedText id="m_161f0efeb9107d" />
                        </div>
                        <RawImage
                          src={currentSignature}
                          alt={tGenerated('m_183a4f7e06a053')}
                          optimizationReason="generated"
                          className="max-h-32 rounded border border-slate-200 bg-white"
                        />
                        <div className="text-xs text-slate-600">
                          <GeneratedValue
                            value={
                              currentSignerName ? (
                                <GeneratedText
                                  id="m_15847a338bfb28"
                                  values={{ value0: currentSignerName }}
                                />
                              ) : (
                                <GeneratedText id="m_142c80b0b4c3f4" />
                              )
                            }
                          />
                          <GeneratedValue
                            value={
                              signedAt ? (
                                <GeneratedText
                                  id="m_141ebd8dd339f1"
                                  values={{ value0: new Date(signedAt).toLocaleString() }}
                                />
                              ) : (
                                ''
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <Alert variant="info">
                        <AlertTitle>
                          <GeneratedText id="m_12ab7a00c79a17" />
                        </AlertTitle>
                        <AlertDescription>
                          <GeneratedText id="m_0ea3ed0dafb3bb" />
                        </AlertDescription>
                      </Alert>
                    )
                  }
                />
              </>
            ) : (
              <form ref={formRef} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_062397e9ebb9aa" />
                  </Label>
                  <Input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={tGenerated('m_026175cd03e182')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0c0bc02db58371" />
                  </Label>
                  <SignaturePad value={signature} onChange={setSignature} height={160} />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={persist} disabled={pending}>
                    <GeneratedValue
                      value={
                        pending ? (
                          <GeneratedText id="m_106811f2aac664" />
                        ) : (
                          <GeneratedText id="m_0e9ffb4d864c14" />
                        )
                      }
                    />
                  </Button>
                  <GeneratedValue
                    value={
                      currentSignature ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={clearSignature}
                          disabled={pending}
                        >
                          <GeneratedText id="m_18702cfb808cf1" />
                        </Button>
                      ) : null
                    }
                  />
                </div>
              </form>
            )
          }
        />
      </CardContent>
    </Card>
  )
}
