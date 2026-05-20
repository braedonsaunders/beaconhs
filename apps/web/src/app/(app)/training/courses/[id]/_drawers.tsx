'use client'

// Course-detail drawers — currently just "add-course-file" which uses the
// FileUploader primitive to push a PDF / DOCX / video into the
// training_course_files table.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'
import {
  Button,
  FileUploader,
  Input,
  Label,
  UrlDrawer,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'

type AddCourseFileAction = (input: {
  courseId: string
  attachmentId: string
  label: string | null
}) => Promise<{ ok: boolean; error?: string }>

export function CourseDrawers({
  courseId,
  openDrawer,
  closeHref,
  addCourseFileAction,
}: {
  courseId: string
  openDrawer: 'add-course-file' | null
  closeHref: string
  addCourseFileAction: AddCourseFileAction
}) {
  return (
    <AddCourseFileDrawer
      open={openDrawer === 'add-course-file'}
      closeHref={closeHref}
      courseId={courseId}
      action={addCourseFileAction}
    />
  )
}

function AddCourseFileDrawer({
  open,
  closeHref,
  courseId,
  action,
}: {
  open: boolean
  closeHref: string
  courseId: string
  action: AddCourseFileAction
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [uploaded, setUploaded] = useState<{
    attachmentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setLabel('')
    setUploaded(null)
    setError(null)
  }

  function submit() {
    setError(null)
    if (!uploaded) {
      setError('Upload a file before saving.')
      return
    }
    startTransition(async () => {
      const res = await action({
        courseId,
        attachmentId: uploaded.attachmentId,
        label: label.trim() || null,
      })
      if (res.ok) {
        toast.success('File attached')
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to attach file'
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Attach a file"
      description="Upload a study material, handout, or recording. Visible to anyone with access to this course."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !uploaded}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Attach file
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder="e.g. Student handbook, Module 3 video"
          />
          <p className="text-[11px] text-slate-500">
            Optional — defaults to the file name if left blank.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>File</Label>
          {uploaded ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-900">
                <FileText size={14} />
                <span className="font-medium">{uploaded.filename}</span>
                <span className="text-xs text-emerald-700">uploaded</span>
              </div>
              <button
                type="button"
                onClick={() => setUploaded(null)}
                className="text-xs font-medium text-emerald-800 hover:underline"
              >
                Replace
              </button>
            </div>
          ) : (
            <FileUploader
              requestUploadAction={requestUpload}
              finalizeUploadAction={finalizeUpload}
              kind="document"
              accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md,.mp4,.mov,.webm,.png,.jpg,.jpeg"
              onUploaded={(f) =>
                setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
              }
              label="Drop a PDF / DOCX / video or click to choose"
              hint="Up to 50 MB."
            />
          )}
        </div>

        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
