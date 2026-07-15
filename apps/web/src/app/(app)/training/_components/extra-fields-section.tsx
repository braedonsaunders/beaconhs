'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const countLabel =
    list.filteredTotal === list.total
      ? list.total.toLocaleString()
      : `${list.filteredTotal.toLocaleString()} of ${list.total.toLocaleString()}`
  const isOutOfRange = list.filteredTotal > 0 && rows.length === 0

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <GeneratedText id="m_0a59518790316d" />
            <GeneratedValue value={countLabel} />)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TableToolbar className="mb-3">
            <SearchInput
              placeholder={tGenerated('m_133107cb3fa0f2')}
              paramKey={list.queryParamKey}
              pageParamKey={list.pageParamKey}
            />
          </TableToolbar>
          <GeneratedValue
            value={
              rows.length === 0 ? (
                <EmptyState
                  icon={<Plus size={24} />}
                  title={tGeneratedValue(
                    isOutOfRange
                      ? tGenerated('m_1809de9b332366')
                      : list.query
                        ? tGenerated('m_03f12d3fa3ac0a')
                        : tGenerated('m_1f711a4298a522'),
                  )}
                  description={tGeneratedValue(
                    isOutOfRange
                      ? tGenerated('m_0020f3aabbf2d3')
                      : list.query
                        ? tGenerated('m_19cceddbc95efe')
                        : tGenerated('m_0bf2f08757030d'),
                  )}
                />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  <GeneratedValue
                    value={rows.map((r) => (
                      <FieldRow
                        key={r.id}
                        row={r}
                        ownerType={ownerType}
                        ownerId={ownerId}
                        deleteAction={deleteAction}
                      />
                    ))}
                  />
                </ul>
              )
            }
          />
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
            <Plus size={14} /> <GeneratedText id="m_05fec91665feb4" />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const res = await deleteAction({ id: row.id, ownerType, ownerId })
      if (res.ok) {
        toast.success(tGenerated('m_1ca393d7995071'))
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_03e9d2c82888d0')))
      }
    })
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={row.fieldKey} />
        </div>
        <div className="mt-0.5 text-sm break-words text-slate-800 dark:text-slate-200">
          <GeneratedValue
            value={row.fieldValue && row.fieldValue.length > 0 ? row.fieldValue : '—'}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={tGenerated('m_0e251e5060fc02')}
        onClick={remove}
        disabled={pending}
      >
        <GeneratedValue
          value={
            pending ? (
              <Loader2 size={14} className="animate-spin text-slate-400" />
            ) : (
              <Trash2 size={14} className="text-red-500" />
            )
          }
        />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [fieldKey, setFieldKey] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const key = fieldKey.trim()
    if (!key) {
      setError(tGenerated('m_0afe2d535ec39f'))
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
        toast.success(tGenerated('m_17da1c493490d8'))
        setFieldKey('')
        setFieldValue('')
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to add field'
        setError(tGeneratedValue(message))
        toast.error(tGeneratedValue(message))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_05cddf1531d157')}
      description={tGenerated('m_165444375089b7')}
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
            <GeneratedText id="m_05fec91665feb4" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fieldKey">
            <GeneratedText id="m_0a50e9d91572df" />{' '}
            <span className="text-red-600 dark:text-red-400">*</span>
          </Label>
          <Input
            id="fieldKey"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.currentTarget.value)}
            placeholder={tGenerated('m_17b02dc5448b92')}
            maxLength={TRAINING_EXTRA_FIELD_KEY_MAX}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fieldValue">
            <GeneratedText id="m_1cc0e5e7b5f442" />
          </Label>
          <Input
            id="fieldValue"
            value={fieldValue}
            onChange={(e) => setFieldValue(e.currentTarget.value)}
            placeholder={tGenerated('m_171e5b15012339')}
            maxLength={TRAINING_EXTRA_FIELD_VALUE_MAX}
          />
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
