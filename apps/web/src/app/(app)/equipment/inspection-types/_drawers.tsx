'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// List-page flyouts for equipment inspection types:
//   • new-type → create flyout (UrlDrawer, opens via ?drawer=new, link-shareable)
//   • DeleteTypeButton → per-row delete guarded by an "are you sure" confirm
//
// Criteria are edited from the type's detail page — the row name links there, so
// no per-row "criteria" button.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button, Drawer, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { IntervalPicker, type IntervalValue } from '@/components/equipment/interval-picker'
import { createEquipmentInspectionType, deleteEquipmentInspectionType } from './_actions'

export function NewTypeDrawer({
  open,
  closeHref,
  types,
}: {
  open: boolean
  closeHref: string
  types: { id: string; name: string }[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [name, setName] = useState('')
  const [appliesToTypeId, setAppliesToTypeId] = useState('')
  const [interval, setInterval] = useState<IntervalValue>({
    isPreUse: false,
    intervalValue: null,
    intervalUnit: null,
  })
  const [description, setDescription] = useState('')
  const [allowPassAll, setAllowPassAll] = useState(true)
  const [failsSpawnWorkOrders, setFailsSpawnWorkOrders] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
      return
    }
    start(async () => {
      const res = await createEquipmentInspectionType({
        name: trimmed,
        description: description.trim() || null,
        intervalValue: interval.intervalValue,
        intervalUnit: interval.intervalUnit,
        isPreUse: interval.isPreUse,
        appliesToTypeId: appliesToTypeId || null,
        allowPassAll,
        failsSpawnWorkOrders,
      })
      if (res.ok) {
        router.push(`/equipment/inspection-types/${res.id}`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error || tGenerated('m_0ac365dcdc6dbd')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_13f748eec4ec4b')}
      description={tGenerated('m_056546cfacd8ff')}
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
            <GeneratedText id="m_043fe9fe859dff" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="eit-name">
            <GeneratedText id="m_1a9978900838e6" />
          </Label>
          <Input
            id="eit-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={tGenerated('m_0e255aad833c42')}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eit-applies">
            <GeneratedText id="m_0cd8311e50d877" />
          </Label>
          <Select
            id="eit-applies"
            value={appliesToTypeId}
            onChange={(e) => setAppliesToTypeId(e.currentTarget.value)}
          >
            <option value="">{'— Any equipment —'}</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <IntervalPicker
          value={interval}
          onChange={setInterval}
          label={tGenerated('m_0d61ed6a4b09fb')}
          allowPreUse
          idPrefix="eit-interval"
        />
        <div className="space-y-1.5">
          <Label htmlFor="eit-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="eit-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={2}
          />
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowPassAll}
              onChange={(e) => setAllowPassAll(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
            />
            <span>
              <GeneratedText id="m_169efe9f907a81" />
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={failsSpawnWorkOrders}
              onChange={(e) => setFailsSpawnWorkOrders(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
            />
            <span>
              <GeneratedText id="m_00bc92b4183bbc" />
            </span>
          </label>
        </div>

        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}

export function DeleteTypeButton({ id, name }: { id: string; name: string }) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function confirm() {
    start(async () => {
      await deleteEquipmentInspectionType({ id })
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={tGenerated('m_06de1e6d468d0c', { value0: name })}
      >
        <Trash2 size={12} />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_0f55d85091996a')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button
              variant="outline"
              className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={confirm}
              disabled={pending}
            >
              <GeneratedValue
                value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
              />
              <GeneratedText id="m_11773f3c3f7558" />
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_11773f3c3f7558" />{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            <GeneratedValue value={name} />
          </span>
          <GeneratedText id="m_08db32a8ad52d9" />
        </p>
      </Drawer>
    </>
  )
}
