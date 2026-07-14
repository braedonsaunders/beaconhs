'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Camera, FileUp, Loader2, Trash2 } from 'lucide-react'
import { Button, uploadReservedFile } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { RawImage } from '@/components/raw-image'

export type AttachedFile = {
  attachmentId: string
  filename: string
  contentType: string
  url: string
}

const KIND_FROM_TYPE = (mime: string): 'image' | 'document' | 'video' | 'audio' | 'other' => {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || mime.includes('document') || mime.includes('sheet'))
    return 'document'
  return 'other'
}

export function FileUpload({
  value,
  onChange,
  accept,
  multiple = true,
  maxFiles,
  onUploadingChange,
  variant = 'file',
}: {
  value: AttachedFile[]
  onChange: (files: AttachedFile[]) => void
  accept?: string
  multiple?: boolean
  maxFiles?: number
  onUploadingChange?: (uploading: boolean) => void
  variant?: 'photo' | 'file' | 'video' | 'audio'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const onUploadingChangeRef = useRef(onUploadingChange)

  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange
  }, [onUploadingChange])

  useEffect(() => {
    onUploadingChangeRef.current?.(pending)
  }, [pending])

  useEffect(
    () => () => {
      onUploadingChangeRef.current?.(false)
    },
    [],
  )

  async function uploadOne(file: File): Promise<AttachedFile | null> {
    const kind = KIND_FROM_TYPE(file.type)
    const req = await requestUpload({
      kind,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    })
    if (!req.ok) {
      setError(req.error)
      return null
    }
    let finalizeInput
    try {
      finalizeInput = await uploadReservedFile(req, file)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed')
      return null
    }
    const fin = await finalizeUpload(finalizeInput)
    if (!fin.ok) {
      setError(fin.error)
      return null
    }
    return {
      attachmentId: fin.attachmentId,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      url: fin.url,
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const remaining = maxFiles === undefined ? files.length : Math.max(0, maxFiles - value.length)
    if (remaining === 0) {
      setError(`You can attach up to ${maxFiles} files`)
      return
    }
    setError(null)
    start(async () => {
      const next: AttachedFile[] = []
      for (const f of Array.from(files).slice(0, remaining)) {
        const uploaded = await uploadOne(f)
        if (uploaded) next.push(uploaded)
      }
      onChange([...value, ...next])
      if (inputRef.current) inputRef.current.value = ''
    })
  }

  const acceptStr =
    accept ??
    (variant === 'photo'
      ? 'image/*'
      : variant === 'video'
        ? 'video/*'
        : variant === 'audio'
          ? 'audio/*'
          : undefined)

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={acceptStr}
        multiple={multiple}
        capture={variant === 'photo' ? 'environment' : undefined}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending || (maxFiles !== undefined && value.length >= maxFiles)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-600 hover:border-teal-500 hover:bg-teal-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-teal-950/40"
      >
        {pending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : variant === 'photo' ? (
          <Camera size={16} />
        ) : (
          <FileUp size={16} />
        )}
        {maxFiles !== undefined && value.length >= maxFiles
          ? `Maximum ${maxFiles} files attached`
          : pending
            ? 'Uploading…'
            : variant === 'photo'
              ? 'Take photo or upload'
              : variant === 'video'
                ? 'Record or upload video'
                : variant === 'audio'
                  ? 'Record or upload audio'
                  : 'Upload file'}
      </button>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {value.length > 0 ? (
        <ul className="space-y-1.5">
          {value.map((f) => (
            <li
              key={f.attachmentId}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex min-w-0 items-center gap-2">
                {f.contentType.startsWith('image/') ? (
                  <RawImage
                    src={f.url}
                    alt=""
                    optimizationReason="authenticated"
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                    <FileUp size={14} />
                  </span>
                )}
                <span className="truncate font-medium">{f.filename}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((x) => x.attachmentId !== f.attachmentId))}
              >
                <Trash2 size={12} className="text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(',')
  const mime = meta?.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64 ?? '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}
