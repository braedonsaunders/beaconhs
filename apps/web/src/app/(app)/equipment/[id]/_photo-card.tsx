'use client'

// The unit's photo at the top of its record card. Managers add, replace or
// remove it right here; the upload is the shared "Take photo or upload"
// control, so phones offer both the camera and the photo library.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Truck } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { FileUpload } from '@/components/file-upload'
import { RawImage } from '@/components/raw-image'
import { confirmDialog } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { setEquipmentPhoto } from '../_actions'

export function EquipmentPhotoCard({
  itemId,
  name,
  photoUrl,
  openLabel,
  canEdit,
}: {
  itemId: string
  name: string
  photoUrl: string | null
  /** "Open full-size photo" — already translated by the page. */
  openLabel: string
  canEdit: boolean
}) {
  const t = useGeneratedValueTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()

  function save(attachmentId: string | null) {
    start(async () => {
      try {
        await setEquipmentPhoto(itemId, attachmentId)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('The photo could not be saved.'))
      }
    })
  }

  async function remove() {
    const ok = await confirmDialog({
      message: t('Remove this unit’s photo?'),
      confirmLabel: t('Remove photo'),
      tone: 'danger',
    })
    if (ok) save(null)
  }

  return (
    <div className="space-y-2">
      {photoUrl ? (
        <a
          href={photoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
          title={openLabel}
        >
          {/* object-contain + a capped height shows portrait and landscape
              photos in full without cropping; the neutral backdrop fills the
              letterbox gap. */}
          <RawImage
            src={photoUrl}
            alt={name}
            optimizationReason="authenticated"
            className="max-h-56 w-full rounded-md bg-slate-100 object-contain dark:bg-slate-800"
          />
        </a>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          <Truck size={48} />
        </div>
      )}
      {canEdit ? (
        <div className="space-y-1.5">
          <FileUpload
            variant="photo"
            multiple={false}
            value={[]}
            showFileList={false}
            disabled={pending}
            onChange={(files) => {
              const [file] = files
              if (file) save(file.attachmentId)
            }}
          />
          {photoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-red-600 hover:text-red-700 dark:text-red-400"
              disabled={pending}
              onClick={() => void remove()}
            >
              <Trash2 size={14} /> <GeneratedValue value="Remove photo" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
