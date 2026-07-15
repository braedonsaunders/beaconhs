'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  contentHtml: string | null
  sourceAttachmentId: string | null
  sourceFilename: string | null
}

export function ContentItemEditor({ item, usedCount }: { item: Item; usedCount: number }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
  const [richContent, setRichContent] = useState({ html: item.contentHtml ?? '' })

  function saveMeta() {
    startTransition(async () => {
      try {
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
        toast.success(tGenerated('m_0a0569b726b225'))
      } catch (error) {
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : tGenerated('m_122238356f02bf')),
        )
      }
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
              <GeneratedValue
                value={
                  usedCount === 0 ? (
                    <GeneratedText id="m_04518f108ba559" />
                  ) : (
                    <GeneratedText
                      id="m_139261a7385fed"
                      values={{ value0: usedCount, value1: usedCount === 1 ? '' : 's' }}
                    />
                  )
                }
              />
            </Badge>
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending}>
              <Trash2 size={14} className="text-rose-500" /> <GeneratedText id="m_11773f3c3f7558" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                <GeneratedText id="m_0decefd558c355" />
              </Label>
              <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_074ba2f160c506" />
              </Label>
              <Select value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)}>
                <option value="rich">
                  <GeneratedText id="m_0c7f4ce2bc6293" />
                </option>
                <option value="slides">
                  <GeneratedText id="m_1c373e80a9436f" />
                </option>
                <option value="video">
                  <GeneratedText id="m_0813322ae97045" />
                </option>
                <option value="file">
                  <GeneratedText id="m_102a42d098d1d2" />
                </option>
                <option value="embed">
                  <GeneratedText id="m_1b25408f216531" />
                </option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_1cdd3166803ea3" />
              </Label>
              <Input
                type="number"
                min="0"
                value={duration}
                onChange={(e) => setDuration(e.currentTarget.value)}
                placeholder={tGenerated('m_1577dda730dc14')}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                <GeneratedText id="m_14d923495cf14c" />
              </Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                <GeneratedText id="m_15379e045ef143" />
              </Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.currentTarget.value)}
                placeholder={tGenerated('m_01cb68683f2ec4')}
              />
            </div>
          </div>

          <GeneratedValue
            value={
              kind === 'embed' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0e3540883d8ce3" />
                  </Label>
                  <Input
                    value={embedUrl}
                    onChange={(e) => setEmbedUrl(e.currentTarget.value)}
                    placeholder="https://…"
                  />
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              kind === 'video' ? (
                <div className="space-y-2">
                  <Label>
                    <GeneratedText id="m_1aa5530c45f2fc" />
                  </Label>
                  <Input
                    value={embedUrl}
                    onChange={(e) => setEmbedUrl(e.currentTarget.value)}
                    placeholder="https://…"
                  />
                  <p className="text-center text-xs text-slate-400">
                    <GeneratedText id="m_06c54e8375b8b1" />
                  </p>
                  <FileUploader
                    requestUploadAction={requestUpload}
                    finalizeUploadAction={finalizeUpload}
                    kind="video"
                    accept=".mp4,.mov,.webm"
                    onUploaded={(f) => {
                      setAttachmentId(f.attachmentId)
                      setEmbedUrl('')
                      toast.success(tGenerated('m_1a95dcb37060a2'))
                    }}
                    label={tGenerated('m_1b420ccbe2591c')}
                  />
                  <GeneratedValue
                    value={
                      attachmentId ? (
                        <p className="text-xs text-emerald-700">
                          <GeneratedText id="m_1fe475e5d5cac4" />
                        </p>
                      ) : null
                    }
                  />
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              kind === 'file' ? (
                <div className="space-y-2">
                  <Label>
                    <GeneratedText id="m_1eb6ff144305c4" />
                  </Label>
                  <FileUploader
                    requestUploadAction={requestUpload}
                    finalizeUploadAction={finalizeUpload}
                    kind="document"
                    accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md"
                    onUploaded={(f) => {
                      setAttachmentId(f.attachmentId)
                      toast.success(tGenerated('m_1a95dcb37060a2'))
                    }}
                    label={tGenerated('m_0c604019085b97')}
                  />
                  <GeneratedValue
                    value={
                      attachmentId ? (
                        <p className="text-xs text-emerald-700">
                          <GeneratedText id="m_116f2ac404e7a8" />
                        </p>
                      ) : null
                    }
                  />
                </div>
              ) : null
            }
          />

          <div className="flex justify-end">
            <Button type="button" onClick={saveMeta} disabled={pending}>
              <GeneratedValue
                value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
              />
              <GeneratedText id="m_03c77ed2bf4459" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <GeneratedValue
        value={
          kind === 'rich' ? (
            <Card>
              <CardContent className="space-y-3 py-5">
                <div className="flex items-center justify-between gap-3">
                  <Label>
                    <GeneratedText id="m_15268f30e4a1fe" />
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await saveContentItemRich(item.id, richContent.html)
                        router.refresh()
                        toast.success(tGenerated('m_1df1d612141628'))
                      })
                    }
                  >
                    <GeneratedValue
                      value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                    />
                    <GeneratedText id="m_0ec54590b165cb" />
                  </Button>
                </div>
                <LessonRibbon editor={activeEditor} />
                <div className="lesson-prose min-h-80 rounded-lg border border-slate-200 bg-white px-10 py-8 dark:border-slate-800 dark:bg-slate-900">
                  <RichEditor
                    initialHtml={item.contentHtml}
                    placeholder={tGenerated('m_170396a551b131')}
                    onChange={setRichContent}
                    onFocusEditor={setActiveEditor}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null
        }
      />

      <GeneratedValue
        value={
          kind === 'slides' ? (
            <Card>
              <CardContent className="space-y-2 py-5">
                <Label>
                  <GeneratedText id="m_09865d01724315" />
                </Label>
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
          ) : null
        }
      />
    </div>
  )
}
