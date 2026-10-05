'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Overview tab (left pane) — edit all document "header" metadata inline. Saves
// automatically (debounced); no Save button. The document content + PDF live in
// the right pane (Write / PDF switch).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, CloudUpload } from 'lucide-react'
import { Input, Label, Select, Textarea } from '@beaconhs/ui'
import { DOCUMENT_METADATA_LIMITS } from '@/lib/document-metadata-limits'
import { toast } from '@/lib/toast'
import { updateDocumentMeta } from './_actions'
import { useRecordAutosaveQueue } from '@/components/use-record-autosave-queue'

type OverviewMeta = {
  title: string
  key: string
  categoryId: string
  typeId: string
  description: string
  reviewFrequencyMonths: string
  nextReviewOn: string
  showDocumentHeader: boolean
  headerIssuedOn: string
  headerRevisedOn: string
  headerApprovedBy: string
  headerVersionLabel: string
}

type SaveState = 'saving' | 'saved' | 'error'

export function DocumentOverview({
  documentId,
  initialMeta,
  categories,
  types,
  hasMaster,
}: {
  documentId: string
  initialMeta: OverviewMeta
  categories: { id: string; name: string }[]
  types: { id: string; name: string }[]
  hasMaster: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [m, setM] = useState<OverviewMeta>(initialMeta)
  const { queue, flush, snapshot } = useRecordAutosaveQueue()
  const saveState: SaveState = snapshot.state === 'dirty' ? 'saving' : snapshot.state
  const latest = useRef(initialMeta)
  const touched = useRef(false)
  useEffect(() => {
    if (snapshot.error) toast.error(tGeneratedValue(snapshot.error))
    if (snapshot.state !== 'saved' || !touched.current) return
    const timer = setTimeout(() => {
      if (!queue.hasWork()) router.refresh()
    }, 400)
    return () => clearTimeout(timer)
  }, [snapshot, queue, router, tGeneratedValue])

  function field<K extends keyof OverviewMeta>(k: K, v: OverviewMeta[K]) {
    const next = { ...latest.current, [k]: v }
    latest.current = next
    touched.current = true
    setM(next)
    queue.schedule('metadata', 650, async () => {
      const result = await updateDocumentMeta({
        ...next,
        documentId,
        categoryId: next.categoryId || null,
        typeId: next.typeId || null,
        description: next.description || null,
        reviewFrequencyMonths: next.reviewFrequencyMonths.trim()
          ? Number(next.reviewFrequencyMonths)
          : null,
        nextReviewOn: next.nextReviewOn || null,
        headerIssuedOn: next.headerIssuedOn || null,
        headerRevisedOn: next.headerRevisedOn || null,
        headerApprovedBy: next.headerApprovedBy || null,
        headerVersionLabel: next.headerVersionLabel || null,
      })
      if (!result.ok) throw new Error(result.error ?? tGenerated('m_04c98d3675a95d'))
    })
  }

  function persist() {
    void flush().catch(() => {})
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          <GeneratedText id="m_11c253e21845f3" />
        </h3>
        <SaveBadge state={saveState} onRetry={persist} />
      </div>
      <div className="space-y-4 p-4">
        <div className="space-y-1.5 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <label
            className="flex items-center gap-2 text-sm font-medium"
            htmlFor="o-document-header"
          >
            <input
              id="o-document-header"
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              checked={m.showDocumentHeader}
              disabled={!hasMaster}
              onChange={(e) => field('showDocumentHeader', e.currentTarget.checked)}
              onBlur={persist}
            />
            <GeneratedText id="m_09e4b0c8b299d1" />
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_1a3548cd328498" />
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="o-issued">
                <GeneratedValue value={'Issue date'} />
              </Label>
              <Input
                id="o-issued"
                type="date"
                value={m.headerIssuedOn}
                onChange={(event) => field('headerIssuedOn', event.currentTarget.value)}
                onBlur={persist}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-revised">
                <GeneratedValue value={'Revision date'} />
              </Label>
              <Input
                id="o-revised"
                type="date"
                value={m.headerRevisedOn}
                onChange={(event) => field('headerRevisedOn', event.currentTarget.value)}
                onBlur={persist}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="o-approved">
                <GeneratedValue value={'Approved by'} />
              </Label>
              <Input
                id="o-approved"
                value={m.headerApprovedBy}
                maxLength={DOCUMENT_METADATA_LIMITS.headerApprovedBy}
                onChange={(event) => field('headerApprovedBy', event.currentTarget.value)}
                onBlur={persist}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="o-version">
                <GeneratedValue value={'Printed version'} />
              </Label>
              <Input
                id="o-version"
                value={m.headerVersionLabel}
                maxLength={DOCUMENT_METADATA_LIMITS.headerVersionLabel}
                onChange={(event) => field('headerVersionLabel', event.currentTarget.value)}
                onBlur={persist}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue
              value={
                'Leave header fields blank to use publication dates, review participants, and the published version number. Draft documents show Draft. A printed version label does not change publication status or version history.'
              }
            />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-title">
            <GeneratedText id="m_0decefd558c355" />
          </Label>
          <Input
            id="o-title"
            value={m.title}
            maxLength={DOCUMENT_METADATA_LIMITS.title}
            onChange={(e) => field('title', e.currentTarget.value)}
            onBlur={persist}
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
              onBlur={persist}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
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
              onBlur={persist}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
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
            onBlur={persist}
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
            onBlur={persist}
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
              onBlur={persist}
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
              onBlur={persist}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <CloudUpload size={12} /> <GeneratedText id="m_106811f2aac664" />
      </span>
    )
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
      >
        <AlertCircle size={12} /> <GeneratedText id="m_13b78c61dbb517" />
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-teal-600" role="status">
      <Check size={12} /> <GeneratedText id="m_0a0569b726b225" />
    </span>
  )
}
