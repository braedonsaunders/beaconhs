'use client'

// Overview tab (left pane) — edit all document "header" metadata inline. Saves
// automatically (debounced); no Save button. The document content + PDF live in
// the right pane (Write / PDF switch).

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CloudUpload } from 'lucide-react'
import { Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import { updateDocumentMeta } from './_actions'

export type OverviewMeta = {
  title: string
  key: string
  categoryId: string
  typeId: string
  description: string
  reviewFrequencyMonths: string
  nextReviewOn: string
  pageSize: 'Letter' | 'A4'
  printHeader: boolean
  printFooter: boolean
  headerText: string
  footerText: string
}

type SaveState = 'idle' | 'saving' | 'saved'

export function DocumentOverview({
  documentId,
  initialMeta,
  categories,
  types,
}: {
  documentId: string
  initialMeta: OverviewMeta
  categories: { id: string; name: string }[]
  types: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [m, setM] = useState<OverviewMeta>(initialMeta)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(
    async (next: OverviewMeta) => {
      const res = await updateDocumentMeta({
        documentId,
        title: next.title,
        key: next.key,
        categoryId: next.categoryId || null,
        typeId: next.typeId || null,
        description: next.description || null,
        reviewFrequencyMonths: next.reviewFrequencyMonths.trim()
          ? Number(next.reviewFrequencyMonths)
          : null,
        nextReviewOn: next.nextReviewOn || null,
        pageSize: next.pageSize,
        printHeader: next.printHeader,
        printFooter: next.printFooter,
        headerText: next.headerText || null,
        footerText: next.footerText || null,
      })
      setSaveState(res.ok ? 'saved' : 'idle')
      // Reflect title/status changes elsewhere on the page, but debounced so we
      // don't refresh on every keystroke.
      if (res.ok) {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => router.refresh(), 400)
      }
    },
    [documentId, router],
  )

  function field<K extends keyof OverviewMeta>(k: K, v: OverviewMeta[K]) {
    setM((prev) => {
      const next = { ...prev, [k]: v }
      setSaveState('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(next), 650)
      return next
    })
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Document details</h3>
        <SaveBadge state={saveState} />
      </div>
      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="o-title">Title</Label>
          <Input id="o-title" value={m.title} onChange={(e) => field('title', e.currentTarget.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-category">Category</Label>
            <Select id="o-category" value={m.categoryId} onChange={(e) => field('categoryId', e.currentTarget.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-type">Type</Label>
            <Select id="o-type" value={m.typeId} onChange={(e) => field('typeId', e.currentTarget.value)}>
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {categories.length === 0 && types.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Create categories &amp; types on the Documents → Categories / Types tabs.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="o-key">Key</Label>
          <Input id="o-key" className="font-mono" value={m.key} onChange={(e) => field('key', e.currentTarget.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-desc">Short description</Label>
          <Textarea id="o-desc" rows={2} value={m.description} onChange={(e) => field('description', e.currentTarget.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-review">Review every (mo.)</Label>
            <Input id="o-review" type="number" min="1" value={m.reviewFrequencyMonths} onChange={(e) => field('reviewFrequencyMonths', e.currentTarget.value)} placeholder="12" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-next">Next review</Label>
            <Input id="o-next" type="date" value={m.nextReviewOn} onChange={(e) => field('nextReviewOn', e.currentTarget.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-page">Page size</Label>
          <Select id="o-page" value={m.pageSize} onChange={(e) => field('pageSize', e.currentTarget.value as 'Letter' | 'A4')}>
            <option value="Letter">Letter</option>
            <option value="A4">A4</option>
          </Select>
        </div>
        <div className="space-y-2 rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">PDF header &amp; footer</p>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={m.printHeader} onChange={(e) => field('printHeader', e.currentTarget.checked)} />
            Print header
          </label>
          {m.printHeader ? (
            <Input value={m.headerText} onChange={(e) => field('headerText', e.currentTarget.value)} placeholder="Header text (optional)" />
          ) : null}
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={m.printFooter} onChange={(e) => field('printFooter', e.currentTarget.checked)} />
            Print footer + page number
          </label>
          {m.printFooter ? (
            <Input value={m.footerText} onChange={(e) => field('footerText', e.currentTarget.value)} placeholder="Footer text (optional)" />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <CloudUpload size={12} /> Saving…
      </span>
    )
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', state === 'saved' ? 'text-teal-600' : 'text-slate-400 dark:text-slate-500')}>
      <Check size={12} /> Saved
    </span>
  )
}
