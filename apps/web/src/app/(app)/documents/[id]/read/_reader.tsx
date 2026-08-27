'use client'

import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronUp, PenLine } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Badge, Button, SignaturePad } from '@beaconhs/ui'
import { SmartBackLink } from '@/components/smart-back-link'
import { acknowledgeDocument } from '../_ack-actions'
import { DocumentPdfPane } from '../_pdf-pane'

type SelfStatus = 'can' | 'acked' | 'unpublished' | 'no-person' | 'no-permission'

export function DocumentReader({
  documentId,
  title,
  documentKey,
  versionNumber,
  selfStatus,
  selfAckedAt,
  canManage,
}: {
  documentId: string
  title: string
  documentKey: string
  versionNumber: number | null
  selfStatus: SelfStatus
  selfAckedAt: string | null
  canManage: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [sig, setSig] = useState<string | null>(null)
  const [sigOpen, setSigOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function submitSelfAck() {
    startTransition(async () => {
      try {
        const res = await acknowledgeDocument({ documentId, signatureDataUrl: sig })
        if (!res.ok) {
          toast.error(tGeneratedValue(res.error))
          return
        }
        toast.success(tGenerated('m_16ab93413661d2'))
        setSig(null)
        setSigOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_1d1fa19fb2f80d')),
        )
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:px-4 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink
          href="/documents"
          label={tGenerated('m_05caa6a53f9b7f')}
          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={title} />
            </span>
            <GeneratedValue
              value={
                versionNumber != null ? (
                  <Badge variant="outline">
                    <GeneratedText id="m_1c693e59d64fb2" />
                    <GeneratedValue value={versionNumber} />
                  </Badge>
                ) : null
              }
            />
          </div>
          <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={documentKey} />
          </div>
        </div>
        <GeneratedValue
          value={
            canManage ? (
              <Link href={`/documents/${documentId}`} className="shrink-0">
                <Button type="button" variant="outline" size="sm">
                  <GeneratedText id="m_03a66f9d34ac7b" />
                </Button>
              </Link>
            ) : null
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        <DocumentPdfPane documentId={documentId} readOnly />
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <GeneratedValue
          value={
            selfStatus === 'acked' ? (
              <Alert variant="success">
                <Check size={16} />
                <AlertTitle>
                  <GeneratedText id="m_0945deabe6292c" />
                </AlertTitle>
                <GeneratedValue
                  value={
                    selfAckedAt ? (
                      <AlertDescription>
                        <GeneratedText id="m_03bc5bb7f90899" />{' '}
                        <GeneratedValue value={new Date(selfAckedAt).toLocaleString()} />.
                      </AlertDescription>
                    ) : null
                  }
                />
              </Alert>
            ) : selfStatus === 'can' ? (
              <div className="mx-auto w-full max-w-xl space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  <GeneratedText id="m_1359a3381f80a2" />
                </p>
                <GeneratedValue
                  value={
                    sigOpen ? (
                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <PenLine size={12} /> <GeneratedText id="m_13cdbd4c691489" />
                        </div>
                        <SignaturePad value={sig} onChange={setSig} height={140} />
                      </div>
                    ) : null
                  }
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="sm:w-auto"
                    onClick={() => setSigOpen((open) => !open)}
                  >
                    <GeneratedValue
                      value={sigOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    />{' '}
                    <GeneratedText id="m_13cdbd4c691489" />
                  </Button>
                  <Button
                    type="button"
                    className="w-full sm:flex-1"
                    onClick={submitSelfAck}
                    disabled={pending}
                  >
                    <Check size={14} />{' '}
                    <GeneratedValue
                      value={
                        pending ? (
                          <GeneratedText id="m_0d17b2ff9d6215" />
                        ) : (
                          <GeneratedText id="m_12ef6648f77371" />
                        )
                      }
                    />
                  </Button>
                </div>
              </div>
            ) : selfStatus === 'unpublished' ? (
              <Alert variant="warning">
                <AlertTitle>
                  <GeneratedText id="m_17f1cc7a464731" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedText id="m_0034e77e69a315" />
                </AlertDescription>
              </Alert>
            ) : selfStatus === 'no-person' ? (
              <Alert variant="warning">
                <AlertTitle>
                  <GeneratedText id="m_03a0cae28cdecf" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedText id="m_17af6e2c8f7d2b" />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
      </div>
    </div>
  )
}
