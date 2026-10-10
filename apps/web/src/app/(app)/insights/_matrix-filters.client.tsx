'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Filter, Loader2 } from 'lucide-react'
import { Button, Drawer } from '@beaconhs/ui'
import { toast } from 'sonner'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import type { PickerLookup } from '@/lib/picker-options'
import type { MatrixSelections } from './_matrix-filters'
import {
  MATRIX_FILTER_PARAM,
  parseMatrixFilters,
  serializeMatrixFilters,
  type MatrixFilters,
} from './_matrix-filter-values'

export function MatrixFilterButton({
  cardId,
  skillMatrix,
  selected,
}: {
  cardId: string
  skillMatrix: boolean
  selected: MatrixSelections
}) {
  const translate = useGeneratedValueTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(selected)
  const [pending, startTransition] = useTransition()
  const count = Object.values(selected).filter((values) => values.length > 0).length
  const fields: {
    key: Exclude<keyof MatrixFilters, 'statuses'>
    label: string
    lookup: PickerLookup
  }[] = [
    { key: 'people', label: 'People', lookup: 'insight-matrix-people' },
    { key: 'departments', label: 'Departments / divisions', lookup: 'insight-matrix-departments' },
    { key: 'groups', label: 'Groups', lookup: 'insight-matrix-groups' },
    {
      key: 'types',
      label: skillMatrix ? 'Skills' : 'Courses',
      lookup: skillMatrix ? 'insight-matrix-skill-types' : 'insight-matrix-courses',
    },
  ]

  function apply(reset = false) {
    try {
      const values = reset
        ? parseMatrixFilters()
        : parseMatrixFilters(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(draft).map(([key, options]) => [
                  key,
                  options.map((option) => option.value),
                ]),
              ),
            ),
          )
      const params = new URLSearchParams(search.toString())
      const serialized = serializeMatrixFilters(values)
      if (serialized) params.set(MATRIX_FILTER_PARAM, serialized)
      else params.delete(MATRIX_FILTER_PARAM)
      params.delete(`matrix_${cardId}_page`)
      startTransition(() =>
        router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false }),
      )
      setOpen(false)
    } catch {
      toast.error(translate('Choose at most 100 filter values.'))
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-9 text-xs"
        disabled={pending}
        onClick={() => {
          setDraft(selected)
          setOpen(true)
        }}
      >
        {pending ? (
          <Loader2 size={13} className="mr-1 animate-spin" />
        ) : (
          <Filter size={13} className="mr-1" />
        )}
        <GeneratedValue value="Filters" />
        {count ? ` (${count})` : null}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={translate('Filters')}
        description={translate('Filter this view without changing the saved matrix.')}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => apply(true)}>
              <GeneratedValue value="Reset" />
            </Button>
            <Button type="button" onClick={() => apply()}>
              <GeneratedValue value="Apply" />
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className={field.key === 'types' ? 'sm:col-span-2' : undefined}>
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                <GeneratedValue value={field.label} />
              </div>
              <RemoteMultiSelect
                lookup={field.lookup}
                value={draft[field.key]}
                onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next }))}
                placeholder={translate('Add…')}
                sheetTitle={translate(field.label)}
                ariaLabel={translate(field.label)}
                max={100}
              />
            </div>
          ))}
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              <GeneratedValue value="Status" />
            </legend>
            <div className="flex flex-wrap gap-4">
              {['valid', 'expiring', 'expired', 'missing'].map((status) => {
                const label = status[0]!.toUpperCase() + status.slice(1)
                return (
                  <label key={status} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.statuses.some((option) => option.value === status)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          statuses: event.target.checked
                            ? [...current.statuses, { value: status, label }]
                            : current.statuses.filter((option) => option.value !== status),
                        }))
                      }
                      className="rounded border-slate-300 text-teal-600 dark:border-slate-600 dark:bg-slate-800"
                    />
                    <GeneratedValue value={label} />
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>
      </Drawer>
    </>
  )
}
