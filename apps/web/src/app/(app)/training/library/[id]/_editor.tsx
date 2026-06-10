'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, FileUploader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import type { LessonBlock, Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
// Shared bespoke editors (also used by the course Studio).
import { BlockEditor } from '../../courses/[id]/studio/_block-editor'
import { SlideEditor } from '../../courses/[id]/studio/_slide-editor'
import {
  deleteContentItem,
  importContentItemPptx,
  saveContentItemBlocks,
  saveContentItemSlides,
  updateContentItem,
} from '../_actions'

type Kind = 'rich' | 'video' | 'file' | 'embed' | 'slides'
type Item = {
  id: string
  title: string
  kind: Kind
  description: string
  tags: string[]
  durationMinutes: number | null
  attachmentId: string | null
  embedUrl: string | null
  contentBlocks: LessonBlock[]
  slides: Slide[]
  importStatus: string | null
  importError: string | null
}

export function ContentItemEditor({
  item,
  usedCount,
  attachmentUrls,
}: {
  item: Item
  usedCount: number
  attachmentUrls: Record<string, string | null | undefined>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(item.title)
  const [kind, setKind] = useState<Kind>(item.kind)
  const [description, setDescription] = useState(item.description)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [duration, setDuration] = useState(item.durationMinutes?.toString() ?? '')
  const [attachmentId, setAttachmentId] = useState(item.attachmentId ?? '')
  const [embedUrl, setEmbedUrl] = useState(item.embedUrl ?? '')

  function saveMeta() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('title', title)
      fd.set('kind', kind)
      fd.set('description', description)
      fd.set('tags', tags)
      fd.set('durationMinutes', duration)
      fd.set('attachmentId', attachmentId)
      fd.set('embedUrl', embedUrl)
      await updateContentItem(item.id, fd)
      router.refresh()
      toast.success('Saved')
    })
  }
  function remove() {
    if (!window.confirm('Delete this library item? It will be detached from any courses using it.'))
      return
    startTransition(async () => {
      await deleteContentItem(item.id)
    })
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">
              {usedCount === 0
                ? 'Not used in any course'
                : `Used in ${usedCount} course${usedCount === 1 ? '' : 's'}`}
            </Badge>
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending}>
              <Trash2 size={14} className="text-rose-500" /> Delete
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)}>
                <option value="rich">Lesson (rich content)</option>
                <option value="slides">Slideshow</option>
                <option value="video">Video</option>
                <option value="file">File</option>
                <option value="embed">Embed</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Duration (min)</Label>
              <Input
                type="number"
                min="0"
                value={duration}
                onChange={(e) => setDuration(e.currentTarget.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.currentTarget.value)}
                placeholder="e.g. safety, onboarding, ppe"
              />
            </div>
          </div>

          {kind === 'embed' ? (
            <div className="space-y-1.5">
              <Label>Embed URL</Label>
              <Input
                value={embedUrl}
                onChange={(e) => setEmbedUrl(e.currentTarget.value)}
                placeholder="https://…"
              />
            </div>
          ) : null}
          {kind === 'video' ? (
            <div className="space-y-2">
              <Label>Video URL (YouTube / Vimeo / MP4)</Label>
              <Input
                value={embedUrl}
                onChange={(e) => setEmbedUrl(e.currentTarget.value)}
                placeholder="https://…"
              />
              <p className="text-center text-xs text-slate-400">— or upload —</p>
              <FileUploader
                requestUploadAction={requestUpload}
                finalizeUploadAction={finalizeUpload}
                kind="video"
                accept=".mp4,.mov,.webm"
                onUploaded={(f) => {
                  setAttachmentId(f.attachmentId)
                  setEmbedUrl('')
                  toast.success('Uploaded — Save details to keep')
                }}
                label="Drop a video or click to choose"
              />
              {attachmentId ? <p className="text-xs text-emerald-700">Uploaded video attached ✓</p> : null}
            </div>
          ) : null}
          {kind === 'file' ? (
            <div className="space-y-2">
              <Label>Downloadable file</Label>
              <FileUploader
                requestUploadAction={requestUpload}
                finalizeUploadAction={finalizeUpload}
                kind="document"
                accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md"
                onUploaded={(f) => {
                  setAttachmentId(f.attachmentId)
                  toast.success('Uploaded — Save details to keep')
                }}
                label="Drop a PDF / handout or click to choose"
              />
              {attachmentId ? <p className="text-xs text-emerald-700">File attached ✓</p> : null}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="button" onClick={saveMeta} disabled={pending}>
              {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
              Save details
            </Button>
          </div>
        </CardContent>
      </Card>

      {kind === 'rich' ? (
        <Card>
          <CardContent className="space-y-2 py-5">
            <Label>Content</Label>
            <BlockEditor
              initialBlocks={item.contentBlocks}
              onSave={async (blocks) => {
                await saveContentItemBlocks(item.id, blocks)
                router.refresh()
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {kind === 'slides' ? (
        <Card>
          <CardContent className="space-y-2 py-5">
            <Label>Slides</Label>
            <SlideEditor
              initialSlides={item.slides}
              attachmentUrls={attachmentUrls}
              importStatus={item.importStatus}
              importError={item.importError}
              onSave={async (slides) => saveContentItemSlides(item.id, slides)}
              onImportPptx={async (attId) => importContentItemPptx(item.id, attId)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
