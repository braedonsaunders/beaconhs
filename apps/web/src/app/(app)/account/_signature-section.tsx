'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Self-service signature capture for the account page. The user draws their
// signature on the shared SignaturePad and saves it to their linked person
// record. Personal consent controls reuse; signed records keep their own
// saved evidence when the profile image changes or is cleared.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, SignaturePad, Label, Select } from '@beaconhs/ui'
import { RawImage } from '@/components/raw-image'
import { toast } from '@/lib/toast'
import { clearMySignature, saveMySignature, saveMySignatureReuseMode } from './actions'

export function SignatureSection({
  currentUrl,
  linked,
  reuseMode = 'off',
}: {
  currentUrl: string | null
  /** False when the login is not linked to a person record — nothing to sign for. */
  linked: boolean
  reuseMode?: 'off' | 'manual' | 'automatic'
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

      <div className="space-y-2">
        <Label htmlFor="signature-reuse">
          <GeneratedValue value="Saved signature reuse" />
        </Label>
        <Select
          id="signature-reuse"
          value={reuseMode}
          disabled={pending || !currentUrl}
          onChange={(e) => {
            const next = e.target.value
            startTransition(async () => {
              const result = await saveMySignatureReuseMode(next)
              if (!result.ok)
                toast.error(tGeneratedValue(result.error ?? 'Could not save signature settings.'))
            })
          }}
        >
          <option value="off">{tGeneratedValue('Off — draw each time')}</option>
          <option value="manual">{tGeneratedValue('Use my saved signature button')}</option>
          <option value="automatic">
            {tGeneratedValue('Automatically fill my signing fields')}
          </option>
        </Select>
        <p className="text-sm text-slate-500">
          <GeneratedValue value="Reuse fills your own signing pad and form fields configured for the creator. You still choose Save or Sign. It never signs for another person or completes an approval automatically." />
        </p>
      </div>
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
