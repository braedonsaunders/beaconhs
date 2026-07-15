'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Per-Builder-app response-PDF templates. Each published app either has its
// own document (link to edit it) or offers "Generate default template" — a
// generated, fully editable layout built from the app's published schema.

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { AppPdfTemplateRow } from '@/lib/module-pdf'
import { generateAppPdfTemplate } from './_actions'

export function AppTemplatesPanel({ rows }: { rows: AppPdfTemplateRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_0a9ed7ef1396eb" />
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <GeneratedValue
        value={rows.map((row) => (
          <AppRow key={row.formTemplateId} row={row} />
        ))}
      />
    </div>
  )
}

function AppRow({ row }: { row: AppPdfTemplateRow }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function onGenerate() {
    startTransition(async () => {
      const res = await generateAppPdfTemplate({ formTemplateId: row.formTemplateId })
      if (res.ok) {
        toast.success(tGenerated('m_00394a024d2e3b'))
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_1e962921c21706')))
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-slate-100">
          <GeneratedValue value={row.appName} />
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue
            value={
              row.template ? (
                <GeneratedText id="m_11e5d5959faf9e" />
              ) : (
                <GeneratedText id="m_088d0c0b0b6616" />
              )
            }
          />
        </p>
      </div>
      <div className="sm:shrink-0">
        <GeneratedValue
          value={
            row.template ? (
              <Link
                href={`/admin/pdf-templates/${row.template.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                <GeneratedValue value={row.template.name} /> <ArrowUpRight size={14} />
              </Link>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onGenerate}
              >
                <Sparkles size={14} />
                <GeneratedValue
                  value={
                    pending ? (
                      <GeneratedText id="m_11beb293de9d2d" />
                    ) : (
                      <GeneratedText id="m_0020b9ba899cbe" />
                    )
                  }
                />
              </Button>
            )
          }
        />
      </div>
    </div>
  )
}
