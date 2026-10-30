'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Overview tab (left pane) — edit all document "header" metadata inline. No
// Save button: every field is local-first (written to this device as you type
// and synced to the `documents` record saver, see ../_record-edits.ts). The
// record provider lives in ./layout.tsx so queued edits keep syncing — and the
// Publish / PDF-preview barriers keep waiting for them — when another tab is
// open. The document content + PDF live in the right pane (Write / PDF switch).

import { useState } from 'react'
import { Input, Label, Select, Textarea } from '@beaconhs/ui'
import { DOCUMENT_METADATA_LIMITS } from '@/lib/document-metadata-limits'
import { RecordFieldError } from '@/components/record-field-error'
import {
  RecordSyncBanner,
  RecordSyncStatus,
  useRecordField,
} from '@/lib/offline-drafts/offline-record'

type OverviewMeta = {
  title: string
  key: string
  categoryId: string
  typeId: string
  description: string
  reviewFrequencyMonths: string
  nextReviewOn: string
  headerIssuedOn: string
  headerRevisedOn: string
  headerApprovedBy: string
  headerVersionLabel: string
}

type TextField = Exclude<keyof OverviewMeta, 'categoryId' | 'typeId'>

export function DocumentOverview({
  initialMeta,
  categories,
  types,
}: {
  initialMeta: OverviewMeta
  categories: { id: string; name: string }[]
  types: { id: string; name: string }[]
}) {
  const category = useRecordField('categoryId', initialMeta.categoryId)
  const type = useRecordField('typeId', initialMeta.typeId)

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          <GeneratedText id="m_11c253e21845f3" />
        </h3>
        <RecordSyncStatus />
      </div>
      <div className="space-y-4 p-4">
        <RecordSyncBanner />
        <div className="space-y-1.5 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue
              value={'Every document PDF includes its control header and print footer.'}
            />
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="o-issued">
                <GeneratedValue value={'Issue date'} />
              </Label>
              <MetaText
                id="o-issued"
                field="headerIssuedOn"
                type="date"
                initialValue={initialMeta.headerIssuedOn}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-revised">
                <GeneratedValue value={'Revision date'} />
              </Label>
              <MetaText
                id="o-revised"
                field="headerRevisedOn"
                type="date"
                initialValue={initialMeta.headerRevisedOn}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="o-approved">
                <GeneratedValue value={'Approved by'} />
              </Label>
              <MetaText
                id="o-approved"
                field="headerApprovedBy"
                initialValue={initialMeta.headerApprovedBy}
                maxLength={DOCUMENT_METADATA_LIMITS.headerApprovedBy}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="o-version">
                <GeneratedValue value={'Printed version'} />
              </Label>
              <MetaText
                id="o-version"
                field="headerVersionLabel"
                initialValue={initialMeta.headerVersionLabel}
                maxLength={DOCUMENT_METADATA_LIMITS.headerVersionLabel}
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
          <MetaText
            id="o-title"
            field="title"
            initialValue={initialMeta.title}
            maxLength={DOCUMENT_METADATA_LIMITS.title}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-category">
              <GeneratedText id="m_108b41637f364f" />
            </Label>
            <Select
              id="o-category"
              value={category.value}
              disabled={category.paused}
              onChange={(e) => category.commit(e.currentTarget.value)}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <RecordFieldError error={category.error} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-type">
              <GeneratedText id="m_074ba2f160c506" />
            </Label>
            <Select
              id="o-type"
              value={type.value}
              disabled={type.paused}
              onChange={(e) => type.commit(e.currentTarget.value)}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <RecordFieldError error={type.error} />
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
          <MetaText
            id="o-key"
            field="key"
            className="font-mono"
            initialValue={initialMeta.key}
            maxLength={DOCUMENT_METADATA_LIMITS.key}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-desc">
            <GeneratedText id="m_0aa6706195a6c8" />
          </Label>
          <MetaText
            id="o-desc"
            field="description"
            multiline
            rows={2}
            initialValue={initialMeta.description}
            maxLength={DOCUMENT_METADATA_LIMITS.description}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-review">
              <GeneratedText id="m_1518910aa83afa" />
            </Label>
            <MetaText
              id="o-review"
              field="reviewFrequencyMonths"
              type="number"
              min="1"
              max={DOCUMENT_METADATA_LIMITS.reviewFrequencyMonths}
              initialValue={initialMeta.reviewFrequencyMonths}
              placeholder="12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-next">
              <GeneratedText id="m_146d385340eb4f" />
            </Label>
            <MetaText
              id="o-next"
              field="nextReviewOn"
              type="date"
              initialValue={initialMeta.nextReviewOn}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function MetaText({
  id,
  field,
  initialValue,
  multiline = false,
  ...props
}: {
  id: string
  field: TextField
  initialValue: string
  multiline?: boolean
  type?: 'text' | 'number' | 'date'
  rows?: number
  maxLength?: number
  min?: string
  max?: number
  placeholder?: string
  className?: string
}) {
  const f = useRecordField(field, initialValue)
  // While the input has focus it shows exactly what was typed: the server
  // trims and slugs values, and adopting that canonical form mid-typing would
  // swallow a trailing space or reshape the key under the cursor.
  const [typed, setTyped] = useState<string | null>(null)
  const shared = {
    id,
    value: typed ?? f.value,
    disabled: f.paused,
    'aria-invalid': f.error ? true : undefined,
    onFocus: () => setTyped(f.value),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setTyped(event.currentTarget.value)
      f.change(event.currentTarget.value)
    },
    onBlur: () => {
      setTyped(null)
      f.commit()
    },
  }
  return (
    <>
      <GeneratedValue
        value={multiline ? <Textarea {...props} {...shared} /> : <Input {...props} {...shared} />}
      />
      <RecordFieldError error={f.error} />
    </>
  )
}
