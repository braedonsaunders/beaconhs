'use client'

// Sub-entity drawer for the toolbox assignments list page:
//   • new-assignment → create a new recurring toolbox-talk assignment
//
// Opens via `?drawer=new-assignment` so it survives refresh + is link-shareable.
// The server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'

type Audience = {
  roleKeys: string[]
  personIds: string[]
  orgUnitIds: string[]
}

type CreateAssignmentAction = (input: {
  name: string
  description: string | null
  cron: string
  dueOffsetDays: number
  compliantPercentage: number
  active: boolean
  audience: Audience
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

export function ToolboxAssignmentsDrawers({
  openDrawer,
  closeHref,
  roleOptions,
  peopleOptions,
  siteOptions,
  createAssignmentAction,
}: {
  openDrawer: 'new-assignment' | null
  closeHref: string
  roleOptions: Array<{ key: string; name: string }>
  peopleOptions: Array<{ id: string; firstName: string | null; lastName: string | null }>
  siteOptions: Array<{ id: string; name: string }>
  createAssignmentAction: CreateAssignmentAction
}) {
  return (
    <NewAssignmentDrawer
      open={openDrawer === 'new-assignment'}
      closeHref={closeHref}
      roleOptions={roleOptions}
      peopleOptions={peopleOptions}
      siteOptions={siteOptions}
      action={createAssignmentAction}
    />
  )
}

function NewAssignmentDrawer({
  open,
  closeHref,
  roleOptions,
  peopleOptions,
  siteOptions,
  action,
}: {
  open: boolean
  closeHref: string
  roleOptions: Array<{ key: string; name: string }>
  peopleOptions: Array<{ id: string; firstName: string | null; lastName: string | null }>
  siteOptions: Array<{ id: string; name: string }>
  action: CreateAssignmentAction
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cron, setCron] = useState('0 7 * * 1')
  const [dueOffsetDays, setDueOffsetDays] = useState('0')
  const [compliantPercentage, setCompliantPercentage] = useState('80')
  const [active, setActive] = useState(true)
  const [roleKeys, setRoleKeys] = useState<string[]>([])
  const [personIds, setPersonIds] = useState<string[]>([])
  const [orgUnitIds, setOrgUnitIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        name: trimmedName,
        description: description.trim() || null,
        cron: cron.trim() || '0 7 * * 1',
        dueOffsetDays: Number(dueOffsetDays) || 0,
        compliantPercentage: Number(compliantPercentage) || 80,
        active,
        audience: { roleKeys, personIds, orgUnitIds },
      })
      if (res.ok) {
        router.push(`/toolbox/assignments/${res.id}`)
        router.refresh()
      } else {
        setError(res.error || 'Failed to create assignment')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New toolbox assignment"
      description="Recurring rule that requires people, roles, or sites to log a toolbox talk on a cadence."
      size="lg"
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
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Create assignment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ta-name">Name *</Label>
          <Input
            id="ta-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Weekly Toolbox — Site A"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ta-description">Description</Label>
          <Textarea
            id="ta-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={2}
            placeholder="What's being required and why"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ta-cron">Cron schedule *</Label>
            <Input
              id="ta-cron"
              value={cron}
              onChange={(e) => setCron(e.currentTarget.value)}
              placeholder="0 7 * * 1"
              required
            />
            <p className="text-xs text-slate-500">
              e.g. <code>0 7 * * 1</code> = Mondays 07:00
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ta-due">Due offset (days)</Label>
            <Input
              id="ta-due"
              type="number"
              min={0}
              max={30}
              value={dueOffsetDays}
              onChange={(e) => setDueOffsetDays(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ta-pct">Compliant % threshold</Label>
            <Input
              id="ta-pct"
              type="number"
              min={0}
              max={100}
              value={compliantPercentage}
              onChange={(e) => setCompliantPercentage(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Active</Label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.currentTarget.checked)}
              />
              Enabled
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ta-roles">Audience: roles</Label>
          <Select
            id="ta-roles"
            multiple
            className="h-32"
            value={roleKeys}
            onChange={(e) => setRoleKeys(getSelectedValues(e.currentTarget))}
          >
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            Cmd/Ctrl-click to pick multiple. Leave empty to skip role filter.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ta-people">Audience: people</Label>
          <Select
            id="ta-people"
            multiple
            className="h-32"
            value={personIds}
            onChange={(e) => setPersonIds(getSelectedValues(e.currentTarget))}
          >
            {peopleOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName ?? ''}, {p.firstName ?? ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ta-sites">Audience: sites</Label>
          <Select
            id="ta-sites"
            multiple
            className="h-24"
            value={orgUnitIds}
            onChange={(e) => setOrgUnitIds(getSelectedValues(e.currentTarget))}
          >
            {siteOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            Empty in all three lists = everyone in the tenant.
          </p>
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

function getSelectedValues(select: HTMLSelectElement): string[] {
  const out: string[] = []
  for (const opt of Array.from(select.selectedOptions)) {
    out.push(opt.value)
  }
  return out
}
