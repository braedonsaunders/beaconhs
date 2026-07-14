'use client'

// "Additional fields" section + URL-drawer used by the skill-type, authority,
// and skill detail pages. Renders the existing rows in a small
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
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import {
  TRAINING_EXTRA_FIELD_KEY_MAX,
  TRAINING_EXTRA_FIELD_VALUE_MAX,
} from '../_lib/extra-field-policy'

type ExtraFieldRow = {
  id: string
  fieldKey: string
  fieldValue: string | null
}

type ExtraFieldListState = {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  total: number
  filteredTotal: number
  query?: string
  page: number
  perPage: number
  queryParamKey: string
  pageParamKey: string
}

type AddExtraFieldAction = (input: {
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  fieldKey: string
  fieldValue: string | null
}) => Promise<{ ok: boolean; error?: string }>

type DeleteExtraFieldAction = (input: {
  id: string
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
}) => Promise<{ ok: boolean; error?: string }>

export function ExtraFieldsSection({
  ownerType,
  ownerId,
  rows,
  list,
  drawerOpen,
  drawerCloseHref,
  addHref,
  addAction,
  deleteAction,
}: {
  ownerType: 'skill' | 'skill_type' | 'authority'
  ownerId: string
  rows: ExtraFieldRow[]
  list: ExtraFieldListState
  drawerOpen: boolean
  drawerCloseHref: string
  addHref: string
  addAction: AddExtraFieldAction
  deleteAction: DeleteExtraFieldAction
}) {
  const countLabel =
    list.filteredTotal === list.total
      ? list.total.toLocaleString()
      : `${list.filteredTotal.toLocaleString()} of ${list.total.toLocaleString()}`
  const isOutOfRange = list.filteredTotal > 0 && rows.length === 0

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Additional fields ({countLabel})</CardTitle>
        </CardHeader>
        <CardContent>
          <TableToolbar className="mb-3">
            <SearchInput
              placeholder="Search field name or value…"
              paramKey={list.queryParamKey}
              pageParamKey={list.pageParamKey}
            />
          </TableToolbar>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={24} />}
              title={
                isOutOfRange
                  ? 'No fields on this page'
                  : list.query
                    ? 'No fields match your search'
                    : 'No custom fields'
              }
              description={
                isOutOfRange
                  ? 'Use the pagination control to return to the last page.'
                  : list.query
                    ? 'Clear the search to see other additional fields.'
                    : "Capture extra fields that don't fit the built-in columns — e.g. issuing union local, reference number."
              }
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
          <Pagination
            basePath={list.basePath}
            currentParams={list.currentParams}
            total={list.filteredTotal}
            page={list.page}
            perPage={list.perPage}
            pageParamKey={list.pageParamKey}
          />
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
            maxLength={TRAINING_EXTRA_FIELD_KEY_MAX}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fieldValue">Value</Label>
          <Input
            id="fieldValue"
            value={fieldValue}
            onChange={(e) => setFieldValue(e.currentTarget.value)}
            placeholder="Leave blank if not applicable"
            maxLength={TRAINING_EXTRA_FIELD_VALUE_MAX}
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
