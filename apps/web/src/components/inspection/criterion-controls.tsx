'use client'

import { useGeneratedTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Button, Label, Textarea, cn } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { PhotoGallery, type GalleryPhoto, type PhotoEdits } from '@/components/photo-gallery'
import { toast } from '@/lib/toast'
import type { InspectionSeverity } from '@/components/builder/inspection-severity'
import { enqueueSerialTask } from './criterion-save-queue'

type CriterionSaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Serializes autosaves from one criterion so rapid field changes cannot arrive
 * out of order and overwrite newer values. Visual state follows only the most
 * recent queued save.
 */
export function useCriterionAutosave() {
  const [state, setState] = React.useState<CriterionSaveState>('idle')
  const [, startTransition] = React.useTransition()
  const router = useRouter()
  const queue = React.useRef<Promise<void>>(Promise.resolve())
  const latestSave = React.useRef(0)
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    },
    [],
  )

  const save = React.useCallback(
    (action: (formData: FormData) => Promise<void>, fields: Record<string, string>) => {
      const saveId = ++latestSave.current
      if (savedTimer.current) {
        clearTimeout(savedTimer.current)
        savedTimer.current = null
      }
      setState('saving')

      const run = async () => {
        const formData = new FormData()
        for (const [key, value] of Object.entries(fields)) formData.set(key, value)
        await action(formData)
      }
      const pending = enqueueSerialTask(queue.current, run)
      queue.current = pending

      startTransition(async () => {
        try {
          await pending
          if (saveId !== latestSave.current) return
          setState('saved')
          savedTimer.current = setTimeout(() => {
            if (saveId === latestSave.current) setState('idle')
          }, 1500)
        } catch {
          if (saveId === latestSave.current) setState('error')
        }
      })
    },
    [],
  )

  return { state, save, refresh: () => router.refresh() }
}

export function CriterionSaveIndicator({ state }: { state: CriterionSaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'text-[11px] font-medium',
        state === 'saving' && 'text-slate-400',
        state === 'saved' && 'text-emerald-600',
        state === 'error' && 'text-red-600',
      )}
    >
      <GeneratedValue
        value={
          state === 'saving' ? (
            <GeneratedText id="m_106811f2aac664" />
          ) : state === 'saved' ? (
            <GeneratedText id="m_0a3bcf685192f1" />
          ) : (
            <GeneratedText id="m_13b78c61dbb517" />
          )
        }
      />
    </span>
  )
}

export function AutosaveTextarea({
  label,
  initial,
  placeholder,
  rows = 2,
  disabled,
  onCommit,
}: {
  label: string
  initial: string | null
  placeholder?: string
  rows?: number
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [value, setValue] = React.useState(initial ?? '')
  const baseline = React.useRef(initial ?? '')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestCommit = React.useRef(onCommit)

  React.useEffect(() => {
    latestCommit.current = onCommit
  }, [onCommit])

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function commit(next: string) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (next === baseline.current) return
    baseline.current = next
    latestCommit.current(next)
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <GeneratedValue value={label} />
      </Label>
      <Textarea
        rows={rows}
        value={value}
        placeholder={tGeneratedValue(placeholder)}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(next), 1000)
        }}
        onBlur={() => commit(value)}
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
}: {
  severity: InspectionSeverity | null
  onPick: (severity: InspectionSeverity) => void
  helper?: React.ReactNode
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
                className={cn(
                  'min-h-10 flex-1 rounded-lg border text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5',
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [pending, startTransition] = React.useTransition()
  const [staged, setStaged] = React.useState<AttachedFile[]>([])

  function attach() {
    if (staged.length === 0 || pending) return
    const formData = new FormData()
    formData.set('recordId', recordId)
    formData.set('rowId', rowId)
    formData.set('attachmentIds', staged.map((file) => file.attachmentId).join(','))
    startTransition(async () => {
      try {
        await addPhotos(formData)
        setStaged([])
        onDone()
      } catch (error) {
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : tGenerated('m_135b02e62854c3')),
        )
      }
    })
  }

  return (
    <div className="space-y-2">
      <FileUpload variant="photo" value={staged} onChange={setStaged} />
      <GeneratedValue
        value={
          staged.length > 0 ? (
            <Button type="button" size="sm" onClick={attach} disabled={pending}>
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_1a0172e9314d7c" />
                  ) : (
                    <>
                      <CheckCircle2 size={14} /> <GeneratedText id="m_0acd5c1caaf69c" />{' '}
                      <GeneratedValue value={staged.length} />{' '}
                      <GeneratedText id="m_07cb1cfb72cff4" />
                      <GeneratedValue
                        value={staged.length === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                      />
                    </>
                  )
                }
              />
            </Button>
          ) : null
        }
      />
    </div>
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
  onDone,
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
  onDone: () => void
}) {
  return (
    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
      <GeneratedValue
        value={
          photoPreviews.length > 0 ? (
            <div className="mb-2">
              <PhotoGallery
                photos={photoPreviews}
                editable={editable && Boolean(updatePhoto && removePhoto)}
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
