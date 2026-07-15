'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Self-service signature capture for the account page. The user draws their
// signature on the shared SignaturePad and saves it to their linked person
// record; every form sign-off / inspection / lift plan / PDF renders it from
// there. Replaces the admin-only image-upload that used to live on the person
// detail page.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, SignaturePad } from '@beaconhs/ui'
import { RawImage } from '@/components/raw-image'
import { toast } from '@/lib/toast'
import { clearMySignature, saveMySignature } from './actions'

export function SignatureSection({
  currentUrl,
  linked,
}: {
  currentUrl: string | null
  /** False when the login is not linked to a person record — nothing to sign for. */
  linked: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [value, setValue] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!linked) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_06549853056af3" />
      </p>
    )
  }

  function save() {
    if (!value) {
      toast.error(tGenerated('m_149195163764d0'))
      return
    }
    startTransition(async () => {
      const res = await saveMySignature(value)
      if (res.ok) {
        toast.success(tGenerated('m_04fb9316c16d3a'))
        setValue(null)
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0066e04e19b3ff')))
      }
    })
  }

  function clear() {
    startTransition(async () => {
      const res = await clearMySignature()
      if (res.ok) {
        toast.success(tGenerated('m_165448b30ce930'))
        setValue(null)
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_01d904b9ed0e4d')))
      }
    })
  }

  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          currentUrl ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <GeneratedText id="m_19588076c1b182" />
              </p>
              <RawImage
                src={currentUrl}
                alt={tGenerated('m_0e9e5ade38fe40')}
                optimizationReason="authenticated"
                className="max-h-20 w-full max-w-xs rounded border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_087b6ca30e3a58" />
            </p>
          )
        }
      />

      <div className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue
            value={
              currentUrl ? (
                <GeneratedText id="m_0644e09c85ced5" />
              ) : (
                <GeneratedText id="m_0b6b95010bd593" />
              )
            }
          />
        </p>
        <SignaturePad value={value} onChange={setValue} ariaLabel="Draw your signature" />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={pending || !value}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedText id="m_0e9ffb4d864c14" />
        </Button>
        <GeneratedValue
          value={
            currentUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={clear}
                disabled={pending}
                className="text-red-600 hover:text-red-700"
              >
                <GeneratedText id="m_1a9d8d971b1edb" />
              </Button>
            ) : null
          }
        />
      </div>
    </div>
  )
}
