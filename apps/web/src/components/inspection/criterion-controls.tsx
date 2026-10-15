'use client'

// Shared building blocks for the site and equipment inspection criterion
// cards. Every editable criterion field binds to the record page's
// <OfflineRecordProvider> (`useRecordField`), so answers and findings are
// written to the device first and synced in the background; photos need
// signal and go straight to the server.

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Label, Textarea, cn } from '@beaconhs/ui'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { PhotoGallery, type GalleryPhoto, type PhotoEdits } from '@/components/photo-gallery'
import { SaveDot } from '@/components/live-field'
import type { FieldSaveState, RecordFieldHandle } from '@/lib/offline-drafts/offline-record'
import type { InspectionSeverity } from '@/components/builder/inspection-severity'

const SAVE_STATE_PRIORITY: FieldSaveState[] = ['error', 'saving', 'dirty', 'saved', 'idle']

/** The one save state a criterion card shows for all of its fields. */
function combinedSaveState(
  fields: ReadonlyArray<Pick<RecordFieldHandle<unknown>, 'saveState'>>,
): FieldSaveState {
  for (const state of SAVE_STATE_PRIORITY) {
    if (fields.some((field) => field.saveState === state)) return state
  }
  return 'idle'
}

/** One save indicator per criterion card, covering every field on it. */
export function CriterionSaveIndicator({
  fields,
}: {
  fields: ReadonlyArray<Pick<RecordFieldHandle<unknown>, 'saveState' | 'error' | 'retry'>>
}) {
  const state = combinedSaveState(fields)
  const failed = state === 'error' ? fields.find((field) => field.saveState === 'error') : null
  return <SaveDot state={state} error={failed?.error ?? null} onRetry={failed?.retry} />
}

/** A finding or note textarea bound to one criterion field. */
export function CriterionTextarea({
  label,
  field,
  placeholder,
  rows = 2,
  maxLength,
  disabled,
}: {
  label: string
  field: RecordFieldHandle<string>
  placeholder?: string
  rows?: number
  maxLength?: number
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <GeneratedValue value={label} />
      </Label>
      <Textarea
        rows={rows}
        value={field.value}
        maxLength={maxLength}
        placeholder={tGeneratedValue(placeholder)}
        disabled={disabled || field.paused}
        onChange={(event) => field.change(event.target.value)}
        onBlur={() => field.commit()}
      />
    </div>
  )
}

export const CRITERION_SEVERITY_OPTIONS: {
  value: InspectionSeverity
  label: string
  active: string
}[] = [
  {
    value: 'low',
    label: 'Low',
    active: 'border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  },
  {
    value: 'medium',
    label: 'Medium',
    active:
      'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700',
  },
  {
    value: 'high',
    label: 'High',
    active:
      'border-orange-400 bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-700',
  },
  {
    value: 'critical',
    label: 'Critical',
    active:
      'border-rose-400 bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-700',
  },
]

export function CriterionSeverityPicker({
  severity,
  onPick,
  helper,
  disabled,
}: {
  severity: InspectionSeverity | null
  onPick: (severity: InspectionSeverity) => void
  helper?: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <GeneratedText id="m_168b365cc671bf" />
      </Label>
      <div className="flex items-center gap-1.5">
        <GeneratedValue
          value={CRITERION_SEVERITY_OPTIONS.map((option) => {
            const active = severity === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onPick(option.value)}
                aria-pressed={active}
                disabled={disabled}
                className={cn(
                  'min-h-10 flex-1 rounded-lg border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5',
                  active
                    ? option.active
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
                )}
              >
                <GeneratedValue value={option.label} />
              </button>
            )
          })}
        />
      </div>
      <GeneratedValue value={helper} />
    </div>
  )
}

function CriterionPhotoUploader({
  recordId,
  rowId,
  addPhotos,
  onDone,
}: {
  recordId: string
  rowId: string
  addPhotos: (formData: FormData) => Promise<void>
  onDone: () => void
}) {
  return (
    <PhotoUploaderSection
      attachAction={async (ids) => {
        const formData = new FormData()
        formData.set('recordId', recordId)
        formData.set('rowId', rowId)
        formData.set('attachmentIds', ids.join(','))
        await addPhotos(formData)
        onDone()
      }}
    />
  )
}

export function CriterionPhotosPanel({
  photoPreviews,
  editable,
  recordId,
  rowId,
  addPhotos,
  updatePhoto,
  removePhoto,
  reorderPhotos,
}: {
  photoPreviews: GalleryPhoto[]
  editable: boolean
  recordId: string
  rowId: string
  addPhotos: (formData: FormData) => Promise<void>
  updatePhoto?: (
    recordId: string,
    rowId: string,
    attachmentId: string,
    input: PhotoEdits,
  ) => Promise<{ ok: boolean; error?: string }>
  removePhoto?: (
    recordId: string,
    rowId: string,
    attachmentId: string,
  ) => Promise<{ ok: boolean; error?: string }>
  reorderPhotos?: (
    recordId: string,
    rowId: string,
    attachmentIds: string[],
  ) => Promise<{ ok: boolean; error?: string }>
}) {
  // Photos need signal (the shared uploader and gallery refuse offline); show
  // the server's copy once a change lands.
  const router = useRouter()
  const onDone = () => router.refresh()
  return (
    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
      <GeneratedValue
        value={
          photoPreviews.length > 0 ? (
            <div className="mb-2">
              <PhotoGallery
                photos={photoPreviews}
                editable={editable}
                onUpdate={
                  updatePhoto
                    ? async (attachmentId, edits) => {
                        const result = await updatePhoto(recordId, rowId, attachmentId, edits)
                        onDone()
                        return result
                      }
                    : undefined
                }
                onRemove={
                  removePhoto
                    ? async (attachmentId) => {
                        const result = await removePhoto(recordId, rowId, attachmentId)
                        onDone()
                        return result
                      }
                    : undefined
                }
                onReorder={
                  reorderPhotos
                    ? async (attachmentIds) => {
                        const result = await reorderPhotos(recordId, rowId, attachmentIds)
                        onDone()
                        return result
                      }
                    : undefined
                }
              />
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          editable ? (
            <CriterionPhotoUploader
              recordId={recordId}
              rowId={rowId}
              addPhotos={addPhotos}
              onDone={onDone}
            />
          ) : null
        }
      />
    </div>
  )
}
