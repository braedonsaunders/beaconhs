'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Photo strip for an entry: mobile-camera capture + upload, AI auto-caption and
// hazard read, remove. Renders from the entry's persisted photos.

import { useTransition } from 'react'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { RawImage } from '@/components/raw-image'
import { toast } from 'sonner'
import { attachJournalPhotos, describeJournalPhoto, removeJournalPhoto } from './_actions'
import type { JournalPhoto } from './_types'

export function Photos({
  entryId,
  photos,
  editable,
  aiEnabled,
  onChange,
}: {
  entryId: string
  photos: JournalPhoto[]
  editable: boolean
  aiEnabled: boolean
  onChange: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [busy, start] = useTransition()

  function onUploaded(files: AttachedFile[]) {
    if (files.length === 0) return
    start(async () => {
      const res = await attachJournalPhotos({
        entryId,
        attachmentIds: files.map((f) => f.attachmentId),
      })
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error))
        return
      }
      onChange()
      if (aiEnabled && res.photoIds.length > 0) {
        await Promise.all(res.photoIds.map((id) => describeJournalPhoto(id)))
        onChange()
      }
    })
  }

  function remove(id: string) {
    start(async () => {
      await removeJournalPhoto(id)
      onChange()
    })
  }

  function describe(id: string) {
    start(async () => {
      const res = await describeJournalPhoto(id)
      if (!res.ok) toast.error(tGeneratedValue(res.error))
      onChange()
    })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
        <GeneratedText id="m_0a07835d0e7c93" />
        <GeneratedValue
          value={busy ? <Loader2 size={12} className="animate-spin text-teal-600" /> : null}
        />
        <GeneratedValue
          value={
            aiEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-1.5 py-px text-[10px] font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                <Sparkles size={10} /> <GeneratedText id="m_126e93eb52cde2" />
              </span>
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <GeneratedValue
                value={photos.map((p) => (
                  <div
                    key={p.id}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                  >
                    <GeneratedValue
                      value={
                        p.url ? (
                          <RawImage
                            src={p.url}
                            alt={tGeneratedValue(p.caption ?? '')}
                            optimizationReason="authenticated"
                            className="h-full w-full object-cover"
                          />
                        ) : null
                      }
                    />

                    <GeneratedValue
                      value={
                        p.caption ? (
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                            <p className="line-clamp-2 text-[10px] leading-tight text-white">
                              <GeneratedValue value={p.caption} />
                            </p>
                          </div>
                        ) : null
                      }
                    />

                    <GeneratedValue
                      value={
                        editable ? (
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <GeneratedValue
                              value={
                                aiEnabled && !p.caption ? (
                                  <button
                                    type="button"
                                    onClick={() => describe(p.id)}
                                    title={tGenerated('m_17f59d8b2a6028')}
                                    className="grid h-6 w-6 place-items-center rounded bg-white/90 text-teal-700 hover:bg-white"
                                  >
                                    <Sparkles size={12} />
                                  </button>
                                ) : null
                              }
                            />
                            <button
                              type="button"
                              onClick={() => remove(p.id)}
                              title={tGenerated('m_1a9d8d971b1edb')}
                              className="grid h-6 w-6 place-items-center rounded bg-white/90 text-red-600 hover:bg-white"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ) : null
                      }
                    />
                  </div>
                ))}
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          editable ? (
            <div className={cn(photos.length > 0 && 'max-w-xs')}>
              <FileUpload variant="photo" value={[]} onChange={onUploaded} />
            </div>
          ) : null
        }
      />
    </div>
  )
}
