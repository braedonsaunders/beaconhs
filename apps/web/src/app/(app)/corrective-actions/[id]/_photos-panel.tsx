'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button, Input } from '@beaconhs/ui'
import { PhotoGallery, type GalleryPhoto } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { confirmDialog } from '@/lib/confirm'
import { attachCaPhotos, deleteCaPhoto, updateCaPhotoCaption } from '../_actions'

export type CaPhotoRow = GalleryPhoto

/**
 * Photos tab body. Combines the shared PhotoGallery (lightbox preview),
 * the shared PhotoUploaderSection (FileUpload → finalizeUpload →
 * attachment FK), and an inline editor for each photo's caption + delete.
 */
export function PhotosPanel({
  caId,
  photos,
  locked,
}: {
  caId: string
  photos: CaPhotoRow[]
  locked: boolean
}) {
  const router = useRouter()
  return (
    <div className="space-y-4">
      {photos.length > 0 ? (
        <>
          <PhotoGallery photos={photos} />
          {!locked ? (
            <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                Captions
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {photos.map((p) => (
                  <PhotoRow key={p.id} caId={caId} photo={p} onChanged={() => router.refresh()} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No photos attached.</p>
      )}
      {!locked ? (
        <PhotoUploaderSection
          attachAction={async (ids) => {
            await attachCaPhotos(caId, ids)
          }}
        />
      ) : null}
    </div>
  )
}

function PhotoRow({
  caId,
  photo,
  onChanged,
}: {
  caId: string
  photo: CaPhotoRow
  onChanged: () => void
}) {
  const [caption, setCaption] = useState(photo.caption ?? '')
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<'caption' | 'delete' | null>(null)

  function saveCaption() {
    if ((caption ?? '') === (photo.caption ?? '')) return
    setBusy('caption')
    start(async () => {
      await updateCaPhotoCaption(caId, photo.id, caption)
      setBusy(null)
      onChanged()
    })
  }

  async function remove() {
    if (!(await confirmDialog({ message: 'Remove this photo from the corrective action?', tone: 'danger' }))) return
    setBusy('delete')
    start(async () => {
      await deleteCaPhoto(caId, photo.id)
      setBusy(null)
      onChanged()
    })
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <img
        src={photo.url}
        alt={photo.caption ?? photo.filename}
        className="h-10 w-10 shrink-0 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{photo.filename}</div>
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={saveCaption}
          placeholder="Add a caption…"
          disabled={pending}
          className="h-7 text-xs"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={pending}
        aria-label="Remove photo"
      >
        <Trash2 size={12} className={busy === 'delete' ? 'text-slate-400' : 'text-red-500'} />
      </Button>
    </li>
  )
}
