'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Sub-entity drawer for the inspection banks list page:
//   • new-bank → create a new inspection criteria bank
//
// Opens via `?drawer=new-bank` so it survives refresh + is link-shareable.
// The server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

const CATEGORIES = [
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'ppe_check', label: 'PPE check' },
  { value: 'equipment_check', label: 'Equipment check' },
  { value: 'vehicle_check', label: 'Vehicle check' },
  { value: 'workplace_audit', label: 'Workplace audit' },
  { value: 'other', label: 'Other' },
]

type CreateBankAction = (input: {
  name: string
  description: string | null
  category: string | null
  isPublished: boolean
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

export function InspectionBanksDrawers({
  openDrawer,
  closeHref,
  createBankAction,
}: {
  openDrawer: 'new-bank' | null
  closeHref: string
  createBankAction: CreateBankAction
}) {
  return (
    <NewBankDrawer
      open={openDrawer === 'new-bank'}
      closeHref={closeHref}
      action={createBankAction}
    />
  )
}

function NewBankDrawer({
  open,
  closeHref,
  action,
}: {
  open: boolean
  closeHref: string
  action: CreateBankAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('site_inspection')
  const [isPublished, setIsPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
      return
    }
    startTransition(async () => {
      const res = await action({
        name: trimmed,
        description: description.trim() || null,
        category: category.trim() || null,
        isPublished,
      })
      if (res.ok) {
        router.push(`/inspections/banks/${res.id}?tab=criteria`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error || tGenerated('m_0b90bd492a4398')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_1263fc017a0994')}
      description={tGenerated('m_08f3632c95611d')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_0c650edf7eae2a" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ib-name">
            <GeneratedText id="m_1a9978900838e6" />
          </Label>
          <Input
            id="ib-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={tGenerated('m_00a9c925dbf230')}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ib-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="ib-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
            placeholder={tGenerated('m_00d5943f5e4611')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ib-category">
            <GeneratedText id="m_108b41637f364f" />
          </Label>
          <Select
            id="ib-category"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
          >
            <GeneratedValue
              value={CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  <GeneratedValue value={c.label} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="ib-published"
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.currentTarget.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <Label htmlFor="ib-published" className="!m-0 cursor-pointer">
            <GeneratedText id="m_16b6226be68998" />
          </Label>
        </div>

        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
