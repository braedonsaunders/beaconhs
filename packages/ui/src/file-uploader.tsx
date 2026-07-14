'use client'

// FileUploader — generic drag-and-drop file picker that hands off the
// pre-signed-upload protocol to the consumer via two callbacks:
//   • requestUploadAction  → presigns a single or multipart upload (server action)
//   • finalizeUploadAction → creates the attachment row (server action)
//
// On success the uploader calls `onUploaded({ attachmentId, ... })` so the
// caller can attach the new attachment id to its own entity. Renders progress
// and per-file error states inline.

import { useCallback, useRef, useState } from 'react'
import { cn } from './utils'

export type UploadRequestResult =
  | { ok: true; uploadId: string; mode: 'single'; putUrl: string }
  | {
      ok: true
      uploadId: string
      mode: 'multipart'
      multipartUploadId: string
      partSizeBytes: number
      partUrls: string[]
    }
  | { ok: false; error: string }

export type FinalizeUploadInput = {
  uploadId: string
  multipartUploadId?: string
}

export type RequestUploadAction = (input: {
  kind: AttachmentKind
  filename: string
  contentType: string
  sizeBytes: number
}) => Promise<UploadRequestResult>

export type FinalizeUploadAction = (
  input: FinalizeUploadInput,
) => Promise<{ ok: true; attachmentId: string; url: string } | { ok: false; error: string }>

export type AttachmentKind = 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'

export type UploadedFile = {
  attachmentId: string
  filename: string
  contentType: string
  sizeBytes: number
  kind: AttachmentKind
  url: string
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
  /** Max size per file in bytes. Defaults per kind (mirrors the server caps). */
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

// Client-side mirror of the server's per-kind ceilings (apps/web requestUpload)
// so oversized files fail fast with a clear message instead of a server error.
const DEFAULT_MAX_BY_KIND: Record<AttachmentKind, number> = {
  image: 50 * 1024 * 1024,
  signature: 10 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  document: 500 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  other: 500 * 1024 * 1024,
}

function uploadWithXhr(args: {
  url: string
  body: Blob
  contentType?: string
  onProgress: (loaded: number) => void
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', args.url)
    if (args.contentType) xhr.setRequestHeader('Content-Type', args.contentType)
    xhr.upload.onprogress = (event) => args.onProgress(event.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(args.body)
  })
}

export async function uploadReservedFile(
  request: Extract<UploadRequestResult, { ok: true }>,
  file: File,
  onProgress: (percent: number) => void = () => undefined,
): Promise<FinalizeUploadInput> {
  if (request.mode === 'single') {
    await uploadWithXhr({
      url: request.putUrl,
      body: file,
      contentType: file.type || 'application/octet-stream',
      onProgress: (loaded) => onProgress(Math.round((loaded / file.size) * 100)),
    })
    return { uploadId: request.uploadId }
  }

  const expectedParts = Math.ceil(file.size / request.partSizeBytes)
  if (request.partUrls.length !== expectedParts) {
    throw new Error('Storage returned an invalid multipart upload plan')
  }
  for (const [index, partUrl] of request.partUrls.entries()) {
    const start = index * request.partSizeBytes
    const end = Math.min(start + request.partSizeBytes, file.size)
    const part = file.slice(start, end, 'application/octet-stream')
    await uploadWithXhr({
      url: partUrl,
      body: part,
      onProgress: (partLoaded) => onProgress(Math.round(((start + partLoaded) / file.size) * 100)),
    })
  }
  return {
    uploadId: request.uploadId,
    multipartUploadId: request.multipartUploadId,
  }
}

export function FileUploader({
  requestUploadAction,
  finalizeUploadAction,
  onUploaded,
  kind = 'document',
  accept,
  multiple = false,
  maxSize,
  compact = false,
  className,
  label = 'Drop files here or click to select',
  hint,
}: FileUploaderProps) {
  const effectiveMaxSize = maxSize ?? DEFAULT_MAX_BY_KIND[kind] ?? 50 * 1024 * 1024
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)

  const upload = useCallback(
    async (file: File, id: string) => {
      const updateItem = (patch: Partial<Item>) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

      if (file.size > effectiveMaxSize) {
        updateItem({
          status: 'error',
          error: `File exceeds ${Math.round(effectiveMaxSize / 1024 / 1024)} MB limit`,
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

      let finalizeInput: FinalizeUploadInput
      try {
        finalizeInput = await uploadReservedFile(req, file, (progress) => updateItem({ progress }))
      } catch (err) {
        updateItem({ status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
        return
      }

      updateItem({ status: 'finalising', progress: 100 })

      const finalise = await finalizeUploadAction(finalizeInput)
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
        url: finalise.url,
      })
    },
    [finalizeUploadAction, kind, effectiveMaxSize, onUploaded, requestUploadAction],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      // Respect `multiple`: a single-file uploader queues only the first file
      // even when several are dropped at once.
      const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1)
      const queued = list.map<Item>((file) => ({
        id: globalThis.crypto.randomUUID(),
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
