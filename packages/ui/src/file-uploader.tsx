'use client'

// FileUploader — generic drag-and-drop file picker that hands off the
// pre-signed-upload protocol to the consumer via two callbacks:
//   • requestUploadAction  → presigns a PUT URL (server action)
//   • finalizeUploadAction → creates the attachment row (server action)
//
// On success the uploader calls `onUploaded({ attachmentId, ... })` so the
// caller can attach the new attachment id to its own entity. Renders progress
// and per-file error states inline.

import { useCallback, useRef, useState } from 'react'
import { cn } from './utils'

export type RequestUploadAction = (input: {
  kind: AttachmentKind
  filename: string
  contentType: string
  sizeBytes: number
}) => Promise<
  { ok: true; key: string; putUrl: string; publicUrl: string } | { ok: false; error: string }
>

export type FinalizeUploadAction = (input: {
  kind: AttachmentKind
  key: string
  filename: string
  contentType: string
  sizeBytes: number
}) => Promise<{ ok: true; attachmentId: string } | { ok: false; error: string }>

export type AttachmentKind = 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'

export type UploadedFile = {
  attachmentId: string
  filename: string
  contentType: string
  sizeBytes: number
  kind: AttachmentKind
  publicUrl: string
}

export type FileUploaderProps = {
  requestUploadAction: RequestUploadAction
  finalizeUploadAction: FinalizeUploadAction
  /** Called once per successfully uploaded file. */
  onUploaded: (file: UploadedFile) => void
  /** Restrict the attachment kind tag we send to the server. */
  kind?: AttachmentKind
  /** HTML accept attribute (e.g. ".pdf,.docx,application/pdf"). */
  accept?: string
  /** Allow more than one file at a time. */
  multiple?: boolean
  /** Max size per file in bytes. Default 50 MB. */
  maxSize?: number
  /** Compact dropzone (no big help text). */
  compact?: boolean
  className?: string
  label?: string
  hint?: string
}

type Item = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'finalising' | 'done' | 'error'
  error?: string
  progress?: number
}

const DEFAULT_MAX = 50 * 1024 * 1024

export function FileUploader({
  requestUploadAction,
  finalizeUploadAction,
  onUploaded,
  kind = 'document',
  accept,
  multiple = false,
  maxSize = DEFAULT_MAX,
  compact = false,
  className,
  label = 'Drop files here or click to select',
  hint,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)

  const upload = useCallback(
    async (file: File, id: string) => {
      const updateItem = (patch: Partial<Item>) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

      if (file.size > maxSize) {
        updateItem({
          status: 'error',
          error: `File exceeds ${Math.round(maxSize / 1024 / 1024)} MB limit`,
        })
        return
      }
      updateItem({ status: 'uploading', progress: 0 })

      const req = await requestUploadAction({
        kind,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })
      if (!req.ok) {
        updateItem({ status: 'error', error: req.error })
        return
      }

      // PUT to the presigned URL with XHR so we get progress events.
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', req.putUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateItem({ progress: Math.round((e.loaded / e.total) * 100) })
            }
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(`Upload failed (HTTP ${xhr.status})`))
          }
          xhr.onerror = () => reject(new Error('Network error during upload'))
          xhr.send(file)
        })
      } catch (err) {
        updateItem({ status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
        return
      }

      updateItem({ status: 'finalising', progress: 100 })

      const finalise = await finalizeUploadAction({
        kind,
        key: req.key,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })
      if (!finalise.ok) {
        updateItem({ status: 'error', error: finalise.error })
        return
      }

      updateItem({ status: 'done' })
      onUploaded({
        attachmentId: finalise.attachmentId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind,
        publicUrl: req.publicUrl,
      })
    },
    [finalizeUploadAction, kind, maxSize, onUploaded, requestUploadAction],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      // Respect `multiple`: a single-file uploader queues only the first file
      // even when several are dropped at once.
      const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1)
      const queued = list.map<Item>((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        status: 'queued',
      }))
      setItems((prev) => [...prev, ...queued])
      for (const q of queued) void upload(q.file, q.id)
    },
    [multiple, upload],
  )

  return (
    <div className={cn('space-y-2', className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors',
          compact ? 'px-3 py-3' : 'px-4 py-6',
          dragOver
            ? 'border-teal-400 bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-300'
            : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-teal-300 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-teal-950/40',
        )}
      >
        <span className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>{label}</span>
        {!compact && hint ? (
          <span className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            handleFiles(e.currentTarget.files)
            // Reset so re-picking the same file (e.g. retry after an error)
            // still fires a change event.
            e.currentTarget.value = ''
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                  {item.file.name}
                </div>
                {item.status === 'error' ? (
                  <div className="text-[11px] text-rose-600 dark:text-rose-400">{item.error}</div>
                ) : item.status === 'done' ? (
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400">Uploaded</div>
                ) : (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {item.status === 'uploading'
                      ? `Uploading… ${item.progress ?? 0}%`
                      : item.status === 'finalising'
                        ? 'Finalising…'
                        : 'Queued'}
                  </div>
                )}
                {(item.status === 'uploading' || item.status === 'finalising') && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-[width] duration-200"
                      style={{ width: `${item.progress ?? 0}%` }}
                    />
                  </div>
                )}
              </div>
              {item.status === 'error' ? (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                  className="rounded px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  Dismiss
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
