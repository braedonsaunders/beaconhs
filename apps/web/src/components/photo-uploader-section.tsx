'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from './file-upload'
import { trackRecordSave, forgetRecordSave } from '@/lib/pending-record-saves'

/** Upload and link are one operation from the user's perspective. A failed link
 * retains uploaded IDs so retry never uploads the same photo twice. */
export function PhotoUploaderSection({
  attachAction,
}: {
  attachAction: (attachmentIds: string[]) => Promise<void>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState<AttachedFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const saveKey = useRef(Symbol('photo-attachment'))
  useEffect(() => {
    const key = saveKey.current
    return () => forgetRecordSave(key)
  }, [])
  function attach(files: AttachedFile[]) {
    if (!files.length || pending) return
    setError(null)
    start(async () => {
      try {
        await trackRecordSave(saveKey.current, attachAction(files.map((file) => file.attachmentId)))
        setFailed([])
        router.refresh()
      } catch (error) {
        setFailed(files)
        setError(error instanceof Error ? error.message : 'Could not attach photos. Please retry.')
      }
    })
  }
  return (
    <div className="space-y-2">
      <FileUpload
        variant="photo"
        value={[]}
        onChange={attach}
        disabled={pending || failed.length > 0}
      />
      {pending ? (
        <p role="status" className="text-sm text-slate-500">
          <GeneratedValue value={'Saving photos…'} />
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>{error}</p>
          <Button type="button" onClick={() => attach(failed)} disabled={pending}>
            <GeneratedValue value={'Retry saving photos'} />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
