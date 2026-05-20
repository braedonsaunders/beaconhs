'use client'

// "New work order" drawer for the equipment item detail page. Opens via
// `?drawer=new-work-order`. Mirrors the legacy /equipment/work-orders/new
// route but slides in instead of navigating away — the item is locked to
// this detail page so the equipment select disappears.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Wrench } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

type CreateWorkOrderInput = {
  itemId: string
  summary: string
  description: string | null
  priority: 'low' | 'med' | 'high'
  assignedToTenantUserId: string | null
  reportedByPersonId: string | null
}

export type CreateWorkOrderAction = (
  input: CreateWorkOrderInput,
) => Promise<{ ok: boolean; error?: string }>

type Assignee = { id: string; displayName: string | null; userName: string | null }
type Reporter = { id: string; firstName: string; lastName: string }

export function NewWorkOrderDrawer({
  open,
  closeHref,
  itemId,
  assignees,
  reporters,
  action,
}: {
  open: boolean
  closeHref: string
  itemId: string
  assignees: Assignee[]
  reporters: Reporter[]
  action: CreateWorkOrderAction
}) {
  const router = useRouter()
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'med' | 'high'>('med')
  const [assignedTo, setAssignedTo] = useState('')
  const [reportedBy, setReportedBy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!summary.trim()) {
      setError('Summary is required.')
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
        setError(res.error ?? 'Failed to create work order')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New work order"
      description="Track a repair, inspection follow-up, or scheduled service against this asset."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Wrench size={14} className="mr-1.5" />
            )}
            Create work order
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="wo-summary">
            Summary <span className="text-red-600">*</span>
          </Label>
          <Input
            id="wo-summary"
            value={summary}
            onChange={(e) => setSummary(e.currentTarget.value)}
            placeholder="e.g. Brake lights inoperative"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wo-description">Description</Label>
          <Textarea
            id="wo-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="What's wrong? Steps to reproduce, smell, sound, error code…"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wo-priority">
              Priority <span className="text-red-600">*</span>
            </Label>
            <Select
              id="wo-priority"
              value={priority}
              onChange={(e) =>
                setPriority(e.currentTarget.value as 'low' | 'med' | 'high')
              }
            >
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-assignee">Assign to</Label>
            <Select
              id="wo-assignee"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.currentTarget.value)}
            >
              <option value="">— Unassigned —</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.userName ?? a.displayName ?? a.id.slice(0, 6)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wo-reporter">Reported by</Label>
            <Select
              id="wo-reporter"
              value={reportedBy}
              onChange={(e) => setReportedBy(e.currentTarget.value)}
            >
              <option value="">— Not specified —</option>
              {reporters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
