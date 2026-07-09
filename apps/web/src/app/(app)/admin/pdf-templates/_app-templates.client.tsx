'use client'

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
        No published Builder apps yet. Publish an app and its default PDF template is generated
        automatically.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <AppRow key={row.formTemplateId} row={row} />
      ))}
    </div>
  )
}

function AppRow({ row }: { row: AppPdfTemplateRow }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function onGenerate() {
    startTransition(async () => {
      const res = await generateAppPdfTemplate({ formTemplateId: row.formTemplateId })
      if (res.ok) {
        toast.success('Default template generated.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Could not generate the template.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-slate-100">{row.appName}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {row.template
            ? 'Record PDFs render this app’s own template.'
            : 'Record PDFs render the generic field-summary layout.'}
        </p>
      </div>
      <div className="sm:shrink-0">
        {row.template ? (
          <Link
            href={`/admin/pdf-templates/${row.template.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            {row.template.name} <ArrowUpRight size={14} />
          </Link>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onGenerate}>
            <Sparkles size={14} />
            {pending ? 'Generating…' : 'Generate default template'}
          </Button>
        )}
      </div>
    </div>
  )
}
