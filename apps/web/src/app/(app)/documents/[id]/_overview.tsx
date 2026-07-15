'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Overview tab (left pane) — edit all document "header" metadata inline. Saves
// automatically (debounced); no Save button. The document content + PDF live in
// the right pane (Write / PDF switch).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, CloudUpload } from 'lucide-react'
import { Input, Label, Select, Textarea } from '@beaconhs/ui'
import { DOCUMENT_METADATA_LIMITS } from '@/lib/document-metadata-limits'
import { toast } from '@/lib/toast'
import { updateDocumentMeta } from './_actions'

type OverviewMeta = {
  title: string
  key: string
  categoryId: string
  typeId: string
  description: string
  reviewFrequencyMonths: string
  nextReviewOn: string
}

type SaveState = 'saving' | 'saved' | 'error'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [m, setM] = useState<OverviewMeta>(initialMeta)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<OverviewMeta | null>(null)
  const flushing = useRef(false)

  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    let lastSaveSucceeded = false
    try {
      while (pending.current) {
        const next = pending.current
        pending.current = null
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
        })
        lastSaveSucceeded = res.ok
        if (!res.ok) {
          setSaveState('error')
          toast.error(tGeneratedValue(res.error ?? tGenerated('m_04c98d3675a95d')))
        }
      }
    } finally {
      flushing.current = false
    }

    // Refresh only after the newest queued edit is durable. Refreshing an
    // older response could otherwise replace newer local text with stale props.
    if (lastSaveSucceeded && !pending.current) {
      setSaveState('saved')
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => router.refresh(), 400)
    }
  }, [documentId, router, tGenerated, tGeneratedValue])

  function field<K extends keyof OverviewMeta>(k: K, v: OverviewMeta[K]) {
    setM((prev) => {
      const next = { ...prev, [k]: v }
      setSaveState('saving')
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      timer.current = setTimeout(() => void flush(), 650)
      return next
    })
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    },
    [],
  )

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          <GeneratedText id="m_11c253e21845f3" />
        </h3>
        <SaveBadge state={saveState} />
      </div>
      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="o-title">
            <GeneratedText id="m_0decefd558c355" />
          </Label>
          <Input
            id="o-title"
            value={m.title}
            maxLength={DOCUMENT_METADATA_LIMITS.title}
            onChange={(e) => field('title', e.currentTarget.value)}
            onBlur={() => void flush()}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-category">
              <GeneratedText id="m_108b41637f364f" />
            </Label>
            <Select
              id="o-category"
              value={m.categoryId}
              onChange={(e) => field('categoryId', e.currentTarget.value)}
              onBlur={() => void flush()}
            >
              <option value="">—</option>
              <GeneratedValue
                value={categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    <GeneratedValue value={c.name} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-type">
              <GeneratedText id="m_074ba2f160c506" />
            </Label>
            <Select
              id="o-type"
              value={m.typeId}
              onChange={(e) => field('typeId', e.currentTarget.value)}
              onBlur={() => void flush()}
            >
              <option value="">—</option>
              <GeneratedValue
                value={types.map((t) => (
                  <option key={t.id} value={t.id}>
                    <GeneratedValue value={t.name} />
                  </option>
                ))}
              />
            </Select>
          </div>
        </div>
        <GeneratedValue
          value={
            categories.length === 0 && types.length === 0 ? (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_189ee770642b15" />
              </p>
            ) : null
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor="o-key">
            <GeneratedText id="m_169ff65a3cfc14" />
          </Label>
          <Input
            id="o-key"
            className="font-mono"
            value={m.key}
            maxLength={DOCUMENT_METADATA_LIMITS.key}
            onChange={(e) => field('key', e.currentTarget.value)}
            onBlur={() => void flush()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-desc">
            <GeneratedText id="m_0aa6706195a6c8" />
          </Label>
          <Textarea
            id="o-desc"
            rows={2}
            value={m.description}
            maxLength={DOCUMENT_METADATA_LIMITS.description}
            onChange={(e) => field('description', e.currentTarget.value)}
            onBlur={() => void flush()}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-review">
              <GeneratedText id="m_1518910aa83afa" />
            </Label>
            <Input
              id="o-review"
              type="number"
              min="1"
              max={DOCUMENT_METADATA_LIMITS.reviewFrequencyMonths}
              value={m.reviewFrequencyMonths}
              onChange={(e) => field('reviewFrequencyMonths', e.currentTarget.value)}
              onBlur={() => void flush()}
              placeholder="12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-next">
              <GeneratedText id="m_146d385340eb4f" />
            </Label>
            <Input
              id="o-next"
              type="date"
              value={m.nextReviewOn}
              onChange={(e) => field('nextReviewOn', e.currentTarget.value)}
              onBlur={() => void flush()}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <CloudUpload size={12} /> <GeneratedText id="m_106811f2aac664" />
      </span>
    )
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600" role="status">
        <AlertCircle size={12} /> <GeneratedText id="m_198e1499058a4a" />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-teal-600" role="status">
      <Check size={12} /> <GeneratedText id="m_0a0569b726b225" />
    </span>
  )
}
