'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  FileUploader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { SlideDeckEditor } from '../../_editor/slide-deck-editor'
import { RichEditor } from '../../_editor/rich-editor'
import { LessonRibbon } from '../../_editor/ribbon'
import { lessonProseCss } from '../../_editor/prose'
import {
  deleteContentItem,
  importContentItemPptx,
  saveContentItemRich,
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
  contentJson: Record<string, unknown> | null
  contentHtml: string | null
  sourceAttachmentId: string | null
  sourceFilename: string | null
}

export function ContentItemEditor({ item, usedCount }: { item: Item; usedCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(item.title)
  const [kind, setKind] = useState<Kind>(item.kind)
  const [description, setDescription] = useState(item.description)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [duration, setDuration] = useState(item.durationMinutes?.toString() ?? '')
  const [attachmentId, setAttachmentId] = useState(item.attachmentId ?? '')
  const [embedUrl, setEmbedUrl] = useState(item.embedUrl ?? '')
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [richContent, setRichContent] = useState({
    json: item.contentJson as unknown,
    html: item.contentHtml ?? '',
  })

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
  async function remove() {
    if (
      !(await confirmDialog({
        message: 'Delete this library item? It will be detached from any courses using it.',
        tone: 'danger',
      }))
    )
      return
    startTransition(async () => {
      await deleteContentItem(item.id)
    })
  }

  return (
    <div className="space-y-5">
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />
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
              {attachmentId ? (
                <p className="text-xs text-emerald-700">Uploaded video attached ✓</p>
              ) : null}
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
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center justify-between gap-3">
              <Label>Content</Label>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await saveContentItemRich(item.id, richContent.json, richContent.html)
                    router.refresh()
                    toast.success('Content saved')
                  })
                }
              >
                {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                Save content
              </Button>
            </div>
            <LessonRibbon editor={activeEditor} />
            <div className="lesson-prose min-h-80 rounded-lg border border-slate-200 bg-white px-10 py-8 dark:border-slate-800 dark:bg-slate-900">
              <RichEditor
                initialJson={item.contentJson}
                initialHtml={item.contentHtml}
                placeholder="Write reusable training content…"
                onChange={setRichContent}
                onFocusEditor={setActiveEditor}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {kind === 'slides' ? (
        <Card>
          <CardContent className="space-y-2 py-5">
            <Label>Slides</Label>
            <div className="flex h-[42rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
              <SlideDeckEditor
                onImportPptx={async (attId) => importContentItemPptx(item.id, attId)}
                target="content_item"
                targetId={item.id}
                master={
                  item.sourceAttachmentId
                    ? {
                        attachmentId: item.sourceAttachmentId,
                        filename: item.sourceFilename ?? 'PowerPoint file',
                      }
                    : null
                }
                className="min-h-0 flex-1"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
