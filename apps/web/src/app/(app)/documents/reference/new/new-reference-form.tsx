'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { createReference } from './actions'

const CATEGORIES = [
  { value: 'sds', label: 'SDS / MSDS' },
  { value: 'manual', label: 'Manual' },
  { value: 'external', label: 'External link' },
  { value: 'standard', label: 'Standard / regulation' },
  { value: 'other', label: 'Other' },
]

export function NewReferenceForm() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('sds')
  const [kind, setKind] = useState<'url' | 'attachment'>('url')
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    if (kind === 'url' && !url.trim()) {
      setError('URL is required when kind is URL')
      return
    }
    if (kind === 'attachment' && files.length === 0) {
      setError('Pick a file to upload, or switch to a URL reference')
      return
    }
    start(async () => {
      const result = await createReference({
        title: title.trim(),
        description: description.trim() || null,
        category: category || null,
        kind,
        url: kind === 'url' ? url.trim() : null,
        attachmentId: kind === 'attachment' ? files[0]?.attachmentId ?? null : null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/documents/reference/${result.id}`)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="space-y-1.5">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Acetone SDS · ABC Chem"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Select
            id="category"
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kind">Kind</Label>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'url' | 'attachment')}
          >
            <option value="url">URL — links to an external page</option>
            <option value="attachment">Attachment — upload a file</option>
          </Select>
        </div>
      </div>
      {kind === 'url' ? (
        <div className="space-y-1.5">
          <Label htmlFor="url">URL *</Label>
          <Input
            id="url"
            name="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/msds.pdf"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>File upload *</Label>
          <FileUpload variant="file" value={files} onChange={setFiles} multiple={false} />
          <p className="text-xs text-slate-500">
            PDFs, images, and Office docs supported up to 50 MB.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href="/documents/reference">
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create reference'}
        </Button>
      </div>
    </form>
  )
}
