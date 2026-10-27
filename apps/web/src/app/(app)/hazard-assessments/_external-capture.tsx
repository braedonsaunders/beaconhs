'use client'

import { useState } from 'react'
import { Button, Input, Textarea } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { GeneratedValue } from '@/i18n/generated'

export function ExternalCapture({
  assessmentId,
  typeAppId,
  reference,
  referenceLabel,
  requirePhoto,
  action,
}: {
  assessmentId: string
  typeAppId: string
  reference: string
  referenceLabel: string
  requirePhoto: boolean
  action: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [photos, setPhotos] = useState<AttachedFile[]>([])
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="w-full">
        <GeneratedValue value="Use external form" />
      </Button>
    )
  }
  return (
    <form action={action} className="mt-3 space-y-3 rounded-md border p-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="typeAppId" value={typeAppId} />
      <input
        type="hidden"
        name="photoIds"
        value={photos.map((photo) => photo.attachmentId).join(',')}
      />
      <p className="text-sm">
        <GeneratedValue value="Write this reference on the external form: " />
        <strong>
          <GeneratedValue value={referenceLabel} />:{' '}
        </strong>
        <strong>{reference}</strong>
      </p>
      <label className="block space-y-1 text-sm">
        <span>
          <GeneratedValue value="Issued by" />
        </span>
        <Input name="issuer" required maxLength={200} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>
          <GeneratedValue value="Notes (optional)" />
        </span>
        <Textarea name="notes" maxLength={2000} rows={2} />
      </label>
      <div className="space-y-1 text-sm">
        <p>
          <GeneratedValue
            value={
              requirePhoto
                ? 'Photos of the completed paper form (required)'
                : 'Photos of the completed paper form (optional)'
            }
          />
        </p>
        <FileUpload variant="photo" value={photos} onChange={setPhotos} maxFiles={10} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">
          <GeneratedValue value="Complete external capture" />
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          <GeneratedValue value="Cancel" />
        </Button>
      </div>
    </form>
  )
}
