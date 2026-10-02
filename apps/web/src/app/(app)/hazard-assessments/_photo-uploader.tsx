'use client'

import { PhotoUploaderSection } from '@/components/photo-uploader-section'

export function HazidPhotoUploader({
  assessmentId,
  attachAction,
}: {
  assessmentId: string
  attachAction: (formData: FormData) => Promise<void>
}) {
  return (
    <PhotoUploaderSection
      attachAction={async (ids) => {
        const form = new FormData()
        form.set('assessmentId', assessmentId)
        form.set('attachmentIds', ids.join(','))
        await attachAction(form)
      }}
    />
  )
}
