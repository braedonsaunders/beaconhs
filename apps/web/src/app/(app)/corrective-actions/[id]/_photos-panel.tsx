'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { PhotoGallery, type GalleryPhoto } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { attachCaPhotos, deleteCaPhoto, updateCaPhoto } from '../_actions'

export type CaPhotoRow = GalleryPhoto

export function PhotosPanel({
  caId,
  photos,
  locked,
}: {
  caId: string
  photos: CaPhotoRow[]
  locked: boolean
}) {
  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          photos.length > 0 ? (
            <PhotoGallery
              photos={photos}
              editable={!locked}
              onUpdate={async (photoId, edits) => updateCaPhoto(caId, photoId, edits)}
              onRemove={async (photoId) => deleteCaPhoto(caId, photoId)}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_177e2d48fbc8cb" />
            </p>
          )
        }
      />
      <GeneratedValue
        value={
          !locked ? (
            <PhotoUploaderSection
              attachAction={async (ids) => {
                await attachCaPhotos(caId, ids)
              }}
            />
          ) : null
        }
      />
    </div>
  )
}
