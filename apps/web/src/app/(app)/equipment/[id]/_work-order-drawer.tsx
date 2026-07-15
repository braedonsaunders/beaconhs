'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// "New work order" drawer for the equipment item detail page. Opens via
// `?drawer=new-work-order`. Mirrors the legacy /equipment/work-orders/new
// route but slides in instead of navigating away — the item is locked to
// this detail page so the equipment select disappears.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Wrench } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

type CreateWorkOrderInput = {
  itemId: string
  summary: string
  description: string | null
  priority: 'low' | 'med' | 'high'
  assignedToTenantUserId: string | null
  reportedByPersonId: string | null
}

type CreateWorkOrderAction = (
  input: CreateWorkOrderInput,
) => Promise<{ ok: boolean; error?: string }>

export function NewWorkOrderDrawer({
  open,
  closeHref,
  itemId,
  action,
}: {
  open: boolean
  closeHref: string
  itemId: string
  action: CreateWorkOrderAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'med' | 'high'>('med')
  const [assignedTo, setAssignedTo] = useState('')
  const [reportedBy, setReportedBy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!summary.trim()) {
      setError(tGenerated('m_0d871cc054b0de'))
      return
    }
    startTransition(async () => {
      const res = await action({
        itemId,
        summary: summary.trim(),
        description: description.trim() || null,
        priority,
        assignedToTenantUserId: assignedTo || null,
        reportedByPersonId: reportedBy || null,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_0b4cd4a6e2f2cc')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_028792f1fdc70a')}
      description={tGenerated('m_1212c0cd1d2eee')}
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
              value={
                pending ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Wrench size={14} className="mr-1.5" />
                )
              }
            />
            <GeneratedText id="m_1d6cea08bfa39b" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="wo-summary">
            <GeneratedText id="m_031c356c80b70f" /> <span className="text-red-600">*</span>
          </Label>
          <Input
            id="wo-summary"
            value={summary}
            maxLength={500}
            onChange={(e) => setSummary(e.currentTarget.value)}
            placeholder={tGenerated('m_0da3b82e035598')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wo-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="wo-description"
            rows={4}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder={tGenerated('m_05f9cf03eb63e5')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wo-priority">
              <GeneratedText id="m_00f0e2904a371c" /> <span className="text-red-600">*</span>
            </Label>
            <Select
              id="wo-priority"
              value={priority}
              onChange={(e) => setPriority(e.currentTarget.value as 'low' | 'med' | 'high')}
            >
              <option value="low">
                <GeneratedText id="m_0ba423ff31902f" />
              </option>
              <option value="med">
                <GeneratedText id="m_1bec287326cfa6" />
              </option>
              <option value="high">
                <GeneratedText id="m_08e161aa889d60" />
              </option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-assignee">
              <GeneratedText id="m_0b44d2ea8f2b0f" />
            </Label>
            <RemoteSearchSelect
              id="wo-assignee"
              lookup="equipment-work-order-assignees"
              value={assignedTo}
              onChange={setAssignedTo}
              placeholder={tGenerated('m_00fa515d7be44e')}
              searchPlaceholder={tGenerated('m_1f0bd3ac120c16')}
              sheetTitle="Assign to"
              ariaLabel="Assign to"
              clearable
              emptyLabel={tGenerated('m_10d1d0d92a9aaa')}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wo-reporter">
              <GeneratedText id="m_036d83ad48ca7a" />
            </Label>
            <RemoteSearchSelect
              id="wo-reporter"
              lookup="equipment-work-order-reporters"
              value={reportedBy}
              onChange={setReportedBy}
              placeholder={tGenerated('m_0be39d3a196b5b')}
              searchPlaceholder={tGenerated('m_06c2338b990aea')}
              sheetTitle="Reported by"
              clearable
              emptyLabel={tGenerated('m_16c1eee898d62b')}
            />
          </div>
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
