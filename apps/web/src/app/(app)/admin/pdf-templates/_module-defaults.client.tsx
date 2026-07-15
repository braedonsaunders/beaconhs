'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Per-module "default print template" assignment. For each native module whose
// PDF button can be templated, pick a tenant template (or keep the generic
// field summary). Changing the Select fires the setModuleDefaultTemplate action.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { ModulePdfDefaultRow } from '@/lib/module-pdf'
import { setModuleDefaultTemplate } from './_actions'

export function ModuleDefaultsPanel({ rows }: { rows: ModulePdfDefaultRow[] }) {
  return (
    <div className="space-y-3">
      <GeneratedValue
        value={rows.map((row) => (
          <ModuleRow key={row.moduleKey} row={row} />
        ))}
      />
    </div>
  )
}

function ModuleRow({ row }: { row: ModulePdfDefaultRow }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        toast.success(
          tGeneratedValue(next ? tGenerated('m_1ef193bf357af4') : tGenerated('m_0a02770cdc5136')),
        )
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_1ee9c316c5ab19')))
        setValue(previous)
      }
    })
  }

  const noTemplates = row.options.length === 0

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-slate-100">
          <GeneratedValue value={row.label} />
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue
            value={
              noTemplates ? (
                <GeneratedText id="m_092f302e877a3a" />
              ) : value ? (
                <GeneratedText id="m_12b85b9130804a" />
              ) : (
                <GeneratedText id="m_0d6c405cc9347e" />
              )
            }
          />
        </p>
      </div>
      <div className="sm:w-72 sm:shrink-0">
        <Select
          value={value}
          onChange={onChange}
          disabled={pending || noTemplates}
          aria-label={tGenerated('m_195230d2917694', { value0: row.label })}
        >
          <option value="">{'Field summary (no template)'}</option>
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
