'use client'

// Bespoke lesson content-block editor. Native to training — NO TipTap, no
// Documents editor, no Forms. Rich text is markdown-lite (rendered safely by
// ../../_lib/blocks). Media blocks use the generic upload primitive.

import { useRef, useState, useTransition } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Heading,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Loader2,
  Minus,
  Paperclip,
  Quote,
  Trash2,
  Type,
  Video,
} from 'lucide-react'
import { Button, FileUploader, Input, Select, Textarea } from '@beaconhs/ui'
import type { LessonBlock } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { renderMd } from '../../../_lib/blocks'

type BlockType = LessonBlock['type']

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b_${Math.random().toString(36).slice(2)}`

function newBlock(type: BlockType): LessonBlock {
  const id = genId()
  switch (type) {
    case 'heading':
      return { id, type: 'heading', level: 2, text: '' }
    case 'text':
      return { id, type: 'text', md: '' }
    case 'callout':
      return { id, type: 'callout', tone: 'info', md: '' }
    case 'image':
      return { id, type: 'image', attachmentId: '', alt: '', caption: '' }
    case 'video':
      return { id, type: 'video', url: '', caption: '' }
    case 'file':
      return { id, type: 'file', attachmentId: '', label: '' }
    case 'embed':
      return { id, type: 'embed', url: '', caption: '' }
    case 'divider':
      return { id, type: 'divider' }
  }
}

const ADD_MENU: { type: BlockType; label: string; icon: React.ReactNode }[] = [
  { type: 'heading', label: 'Heading', icon: <Heading size={14} /> },
  { type: 'text', label: 'Text', icon: <Type size={14} /> },
  { type: 'callout', label: 'Callout', icon: <Quote size={14} /> },
  { type: 'image', label: 'Image', icon: <ImageIcon size={14} /> },
  { type: 'video', label: 'Video', icon: <Video size={14} /> },
  { type: 'file', label: 'File', icon: <Paperclip size={14} /> },
  { type: 'embed', label: 'Embed', icon: <Link2 size={14} /> },
  { type: 'divider', label: 'Divider', icon: <Minus size={14} /> },
]

export function BlockEditor({
  initialBlocks,
  onSave,
  onChange,
  inline = false,
}: {
  initialBlocks: LessonBlock[]
  /** Standalone mode: persist on the Save button. */
  onSave?: (blocks: LessonBlock[]) => Promise<void>
  /** Inline mode: fire on every mutation (parent owns persistence). */
  onChange?: (blocks: LessonBlock[]) => void
  /** Hide the save bar; use with onChange when embedded in a larger editor. */
  inline?: boolean
}) {
  const [blocks, setBlocks] = useState<LessonBlock[]>(initialBlocks ?? [])
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()

  function commit(next: LessonBlock[]) {
    setBlocks(next)
    setDirty(true)
    onChange?.(next)
  }
  function update(id: string, patch: Partial<LessonBlock>) {
    commit(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as LessonBlock) : b)))
  }
  function add(type: BlockType) {
    commit([...blocks, newBlock(type)])
  }
  function remove(id: string) {
    commit(blocks.filter((b) => b.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    commit(next)
  }
  function save() {
    startTransition(async () => {
      await onSave?.(blocks)
      setDirty(false)
      toast.success('Lesson content saved')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
        <span className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          Add block:
        </span>
        {ADD_MENU.map((m) => (
          <Button
            key={m.type}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => add(m.type)}
          >
            {m.icon}
            <span className="ml-1">{m.label}</span>
          </Button>
        ))}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          No content. Add a block to build this lesson.
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((b, i) => (
            <div
              key={b.id}
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
                <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                  {b.type}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(b.id, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === blocks.length - 1}
                    onClick={() => move(b.id, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(b.id)}
                    aria-label="Delete block"
                  >
                    <Trash2 size={14} className="text-rose-500" />
                  </Button>
                </div>
              </div>
              <div className="p-3">
                <BlockBody block={b} update={update} />
              </div>
            </div>
          ))}
        </div>
      )}

      {inline ? null : (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          {dirty ? (
            <span className="text-xs text-amber-600 dark:text-amber-300">Unsaved changes</span>
          ) : null}
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save content
          </Button>
        </div>
      )}
    </div>
  )
}

function BlockBody({
  block,
  update,
}: {
  block: LessonBlock
  update: (id: string, patch: Partial<LessonBlock>) => void
}) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex gap-2">
          <Select
            value={String(block.level)}
            onChange={(e) =>
              update(block.id, { level: Number(e.currentTarget.value) as 1 | 2 | 3 })
            }
            className="w-24"
          >
            <option value="1">H1</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
          </Select>
          <Input
            value={block.text}
            onChange={(e) => update(block.id, { text: e.currentTarget.value })}
            placeholder="Heading text"
          />
        </div>
      )
    case 'text':
      return <MarkdownField value={block.md} onChange={(md) => update(block.id, { md })} />
    case 'callout':
      return (
        <div className="space-y-2">
          <Select
            value={block.tone}
            onChange={(e) =>
              update(block.id, {
                tone: e.currentTarget.value as 'info' | 'warning' | 'success' | 'danger',
              })
            }
            className="w-40"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
            <option value="danger">Danger</option>
          </Select>
          <MarkdownField value={block.md} onChange={(md) => update(block.id, { md })} />
        </div>
      )
    case 'image':
      return (
        <div className="space-y-2">
          {block.attachmentId ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Image uploaded ✓ (replace by uploading again)
            </p>
          ) : null}
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="image"
            accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
            onUploaded={(f) => update(block.id, { attachmentId: f.attachmentId })}
            label="Drop an image or click to choose"
          />
          <Input
            value={block.alt ?? ''}
            onChange={(e) => update(block.id, { alt: e.currentTarget.value })}
            placeholder="Alt text (accessibility)"
          />
          <Input
            value={block.caption ?? ''}
            onChange={(e) => update(block.id, { caption: e.currentTarget.value })}
            placeholder="Caption (optional)"
          />
        </div>
      )
    case 'video':
      return (
        <div className="space-y-2">
          <Input
            value={block.url ?? ''}
            onChange={(e) =>
              update(block.id, { url: e.currentTarget.value, attachmentId: undefined })
            }
            placeholder="YouTube / Vimeo / MP4 URL"
          />
          <p className="text-center text-xs text-slate-400 dark:text-slate-500">— or upload —</p>
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="video"
            accept=".mp4,.mov,.webm"
            onUploaded={(f) => update(block.id, { attachmentId: f.attachmentId, url: undefined })}
            label="Drop a video or click to choose"
          />
          <Input
            value={block.caption ?? ''}
            onChange={(e) => update(block.id, { caption: e.currentTarget.value })}
            placeholder="Caption (optional)"
          />
        </div>
      )
    case 'file':
      return (
        <div className="space-y-2">
          {block.attachmentId ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">File uploaded ✓</p>
          ) : null}
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="document"
            accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md"
            onUploaded={(f) =>
              update(block.id, { attachmentId: f.attachmentId, label: block.label || f.filename })
            }
            label="Drop a handout / PDF or click to choose"
          />
          <Input
            value={block.label ?? ''}
            onChange={(e) => update(block.id, { label: e.currentTarget.value })}
            placeholder="Download label"
          />
        </div>
      )
    case 'embed':
      return (
        <Input
          value={block.url}
          onChange={(e) => update(block.id, { url: e.currentTarget.value })}
          placeholder="Embed URL (https://…)"
        />
      )
    case 'divider':
      return (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">Horizontal divider</p>
      )
  }
}

function MarkdownField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  function wrap(token: string, end = token) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const stop = el.selectionEnd ?? value.length
    const selected = value.slice(start, stop) || 'text'
    onChange(value.slice(0, start) + token + selected + end + value.slice(stop))
  }
  function prefixLine(prefix: string) {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => wrap('**')}
          aria-label="Bold"
        >
          <Bold size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => wrap('*')}
          aria-label="Italic"
        >
          <Italic size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => prefixLine('- ')}
          aria-label="Bullet list"
        >
          <List size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => wrap('[', '](https://)')}
          aria-label="Link"
        >
          <Link2 size={14} />
        </Button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div
          className="min-h-[4rem] space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          dangerouslySetInnerHTML={{ __html: renderMd(value) }}
        />
      ) : (
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          rows={4}
          placeholder="Write lesson text — **bold**, *italic*, - bullets, [links](https://…)"
        />
      )}
    </div>
  )
}
