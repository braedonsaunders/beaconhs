'use client'

// Per-module "default print template" assignment. For each native module whose
// PDF button can be templated, pick a tenant template (or keep the built-in
// layout). Changing the Select fires the setModuleDefaultTemplate action.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { ModulePdfDefaultRow } from '@/lib/module-pdf'
import { setModuleDefaultTemplate } from './_actions'

export function ModuleDefaultsPanel({ rows }: { rows: ModulePdfDefaultRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ModuleRow key={row.moduleKey} row={row} />
      ))}
    </div>
  )
}

function ModuleRow({ row }: { row: ModulePdfDefaultRow }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [value, setValue] = React.useState(row.selectedId ?? '')

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    const previous = value
    setValue(next)
    startTransition(async () => {
      const res = await setModuleDefaultTemplate({
        moduleKey: row.moduleKey,
        templateId: next || null,
      })
      if (res.ok) {
        toast.success(next ? 'Default print template updated.' : 'Reverted to the built-in template.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Could not update the default.')
        setValue(previous)
      }
    })
  }

  const noTemplates = row.options.length === 0

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-slate-100">{row.label}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {noTemplates
            ? 'No template built for this module yet — create one above with this module as its record type.'
            : value
              ? 'Print button renders this template.'
              : 'Print button renders the built-in layout.'}
        </p>
      </div>
      <div className="sm:w-72 sm:shrink-0">
        <Select
          value={value}
          onChange={onChange}
          disabled={pending || noTemplates}
          aria-label={`Default print template for ${row.label}`}
        >
          <option value="">Built-in default</option>
          {row.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
