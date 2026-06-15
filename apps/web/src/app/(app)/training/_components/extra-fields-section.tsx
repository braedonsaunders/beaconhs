'use client'

// "Additional fields" section + URL-drawer used by the skill-type, authority,
// and (future) skill detail pages.  Renders the existing rows in a small
// table and exposes an inline delete + a "?drawer=add-extra-field" drawer
// for new ones.
//
// The two server actions (add / delete) are passed in from the RSC parent.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  UrlDrawer,
} from '@beaconhs/ui'
import { toast } from '@/lib/toast'

export type ExtraFieldRow = {
  id: string
  fieldKey: string
  fieldValue: string | null
}

export type AddExtraFieldAction = (input: {
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  fieldKey: string
  fieldValue: string | null
}) => Promise<{ ok: boolean; error?: string }>

export type DeleteExtraFieldAction = (input: {
  id: string
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
}) => Promise<{ ok: boolean; error?: string }>

export function ExtraFieldsSection({
  ownerType,
  ownerId,
  rows,
  drawerOpen,
  drawerCloseHref,
  addHref,
  addAction,
  deleteAction,
}: {
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  rows: ExtraFieldRow[]
  drawerOpen: boolean
  drawerCloseHref: string
  addHref: string
  addAction: AddExtraFieldAction
  deleteAction: DeleteExtraFieldAction
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Additional fields ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={24} />}
              title="No custom fields"
              description="Capture extra fields that don't fit the built-in columns — e.g. issuing union local, reference number."
            />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {rows.map((r) => (
                <FieldRow
                  key={r.id}
                  row={r}
                  ownerType={ownerType}
                  ownerId={ownerId}
                  deleteAction={deleteAction}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="mt-3 flex justify-end">
        <Link href={addHref}>
          <Button type="button">
            <Plus size={14} /> Add field
          </Button>
        </Link>
      </div>
      <AddExtraFieldDrawer
        open={drawerOpen}
        closeHref={drawerCloseHref}
        ownerType={ownerType}
        ownerId={ownerId}
        action={addAction}
      />
    </>
  )
}

function FieldRow({
  row,
  ownerType,
  ownerId,
  deleteAction,
}: {
  row: ExtraFieldRow
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  deleteAction: DeleteExtraFieldAction
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const res = await deleteAction({ id: row.id, ownerType, ownerId })
      if (res.ok) {
        toast.success('Field removed')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Failed to remove field')
      }
    })
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {row.fieldKey}
        </div>
        <div className="mt-0.5 text-sm break-words text-slate-800 dark:text-slate-200">
          {row.fieldValue && row.fieldValue.length > 0 ? row.fieldValue : '—'}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Remove field"
        onClick={remove}
        disabled={pending}
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin text-slate-400" />
        ) : (
          <Trash2 size={14} className="text-red-500" />
        )}
      </Button>
    </li>
  )
}

function AddExtraFieldDrawer({
  open,
  closeHref,
  ownerType,
  ownerId,
  action,
}: {
  open: boolean
  closeHref: string
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  action: AddExtraFieldAction
}) {
  const router = useRouter()
  const [fieldKey, setFieldKey] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const key = fieldKey.trim()
    if (!key) {
      setError('Field name is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        ownerType,
        ownerId,
        fieldKey: key,
        fieldValue: fieldValue.trim() || null,
      })
      if (res.ok) {
        toast.success('Field added')
        setFieldKey('')
        setFieldValue('')
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to add field'
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Add additional field"
      description="Free-form key/value pair shown alongside the built-in columns on this record."
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
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Add field
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fieldKey">
            Field name <span className="text-red-600 dark:text-red-400">*</span>
          </Label>
          <Input
            id="fieldKey"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.currentTarget.value)}
            placeholder="e.g. Local, Reference number, Renewal contact"
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fieldValue">Value</Label>
          <Input
            id="fieldValue"
            value={fieldValue}
            onChange={(e) => setFieldValue(e.currentTarget.value)}
            placeholder="Leave blank if not applicable"
            maxLength={500}
          />
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
