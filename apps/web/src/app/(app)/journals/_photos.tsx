'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { useTransition } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { PhotoGallery } from '@/components/photo-gallery'
import { toast } from 'sonner'
import {
  attachJournalPhotos,
  describeJournalPhoto,
  removeJournalPhoto,
  updateJournalPhoto,
} from './_actions'
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
  const [busy, start] = useTransition()

  function onUploaded(files: AttachedFile[]) {
    if (files.length === 0) return
    start(async () => {
      const result = await attachJournalPhotos({
        entryId,
        attachmentIds: files.map((file) => file.attachmentId),
      })
      if (!result.ok) {
        toast.error(tGeneratedValue(result.error))
        return
      }
      onChange()
      if (aiEnabled && result.photoIds.length > 0) {
        await Promise.all(result.photoIds.map((id) => describeJournalPhoto(id)))
        onChange()
      }
    })
  }

  function describe(id: string) {
    start(async () => {
      const result = await describeJournalPhoto(id)
      if (!result.ok) toast.error(tGeneratedValue(result.error))
      onChange()
    })
  }

  const visiblePhotos = photos
    .filter((photo) => Boolean(photo.url))
    .map((photo) => ({ ...photo, url: photo.url! }))

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

      {visiblePhotos.length > 0 ? (
        <PhotoGallery
          photos={visiblePhotos}
          editable={editable}
          onUpdate={async (photoId, edits) => {
            const result = await updateJournalPhoto(photoId, edits)
            onChange()
            return result
          }}
          onRemove={async (photoId) => {
            const result = await removeJournalPhoto(photoId)
            onChange()
            return result
          }}
        />
      ) : null}

      {editable && aiEnabled && photos.some((photo) => !photo.caption) ? (
        <div className="flex flex-wrap gap-2">
          {photos
            .filter((photo) => !photo.caption)
            .map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => describe(photo.id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-teal-200 px-2.5 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-300 dark:hover:bg-teal-950/40"
              >
                <Sparkles size={12} /> <GeneratedValue value="Generate caption for" />{' '}
                <span className="max-w-48 truncate">{photo.filename}</span>
              </button>
            ))}
        </div>
      ) : null}

      {editable ? (
        <div className={cn(photos.length > 0 && 'max-w-xs')}>
          <FileUpload variant="photo" value={[]} onChange={onUploaded} />
        </div>
      ) : null}
    </div>
  )
}
