'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Camera } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'

export function HazidPhotoUploader({
  assessmentId,
  attachAction,
}: {
  assessmentId: string
  attachAction: (formData: FormData) => Promise<void>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [staged, setStaged] = useState<AttachedFile[]>([])

  function attach() {
    if (staged.length === 0) return
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('attachmentIds', staged.map((s) => s.attachmentId).join(','))
    start(async () => {
      await attachAction(fd)
      setStaged([])
      router.refresh()
    })
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Camera size={14} /> Add photos
      </div>
      <FileUpload variant="photo" value={staged} onChange={setStaged} />
      {staged.length > 0 ? (
        <Button onClick={attach} disabled={pending}>
          {pending ? 'Attaching…' : `Attach ${staged.length} photo${staged.length === 1 ? '' : 's'}`}
        </Button>
      ) : null}
    </div>
  )
}
