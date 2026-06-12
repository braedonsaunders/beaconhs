'use client'

// The lesson editor surface — fills the right 2/3 of the course builder when a
// lesson is open (fullscreen optional). Documents-editor conventions: slim top
// bar, Office-style ribbon, direct inline WYSIWYG editing on the content
// itself (TipTap pages, Fabric slide canvas), autosave with a save badge.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Editor } from '@tiptap/react'
import {
  ArrowLeft,
  Check,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, cn } from '@beaconhs/ui'
import type { PracticalCriterion, Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { RichEditor } from '../../_editor/rich-editor'
import { LessonRibbon } from '../../_editor/ribbon'
import { lessonProseCss } from '../../_editor/prose'
import { blocksToHtml } from '../../_editor/legacy'
import { SlideDeckEditor } from '../../_editor/slide-deck-editor'
import { ensureCanvasDeck } from '../../_editor/slide-model'
import type { CompletionRule, LessonKind, LessonLite } from './_workspace'
import {
  deleteLesson,
  importLessonPptx,
  saveLessonRich,
  saveLessonSlides,
  updateLesson,
} from './studio/_actions'

type SaveState = 'saved' | 'dirty' | 'saving'

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s_${Math.random().toString(36).slice(2)}`

export function LessonSurface({
  courseId,
  lesson,
  assessmentTypes,
  classes,
  contentItems,
  attachmentUrls,
  onClose,
}: {
  courseId: string
  lesson: LessonLite
  assessmentTypes: { id: string; name: string }[]
  classes: { id: string; title: string }[]
  contentItems: { id: string; title: string; kind: string }[]
  attachmentUrls: Record<string, string | null | undefined>
  onClose: () => void
}) {
  const router = useRouter()
  const [fullscreen, setFullscreen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')

  // --- lesson meta (autosaved) ---
  const [title, setTitle] = useState(lesson.title)
  const [kind, setKind] = useState<LessonKind>(lesson.kind)
  const [rule, setRule] = useState<CompletionRule>(lesson.completionRule)
  const [required, setRequired] = useState(lesson.isRequired)
  const [assessmentTypeId, setAssessmentTypeId] = useState(lesson.assessmentTypeId ?? '')
  const [classId, setClassId] = useState(lesson.classId ?? '')
  const [attachmentId, setAttachmentId] = useState(lesson.attachmentId ?? '')
  const [embedUrl, setEmbedUrl] = useState(lesson.embedUrl ?? '')
  const [contentItemId, setContentItemId] = useState(lesson.contentItemId ?? '')
  const [duration, setDuration] = useState(lesson.durationMinutes?.toString() ?? '')
  const [criteria, setCriteria] = useState<PracticalCriterion[]>(lesson.practicalCriteria ?? [])

  // --- slides deck (autosaved; legacy structured slides convert to the Fabric
  // canvas model on the client and persist as canvas on first edit). The
  // initializer must NOT convert: conversion needs DOMParser, which differs
  // between SSR and the browser — the adopt effect below converts post-mount.
  const [deck, setDeck] = useState<Slide[]>(lesson.slides ?? [])
  const deckDirtyRef = useRef(false)

  // --- debounced autosave plumbing ---
  const inflight = useRef(0)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const schedule = useCallback((key: string, ms: number, fn: () => Promise<void>) => {
    setSaveState('dirty')
    if (timers.current[key]) clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      inflight.current += 1
      setSaveState('saving')
      fn()
        .catch((e) => toast.error(e instanceof Error ? e.message : 'Save failed'))
        .finally(() => {
          inflight.current -= 1
          if (inflight.current === 0) setSaveState('saved')
        })
    }, ms)
  }, [])
  // Flush-on-unmount safety: clear timers (last debounce may be lost on hard
  // close — Done triggers an immediate flush below instead).
  useEffect(() => {
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [])

  const metaRef = useRef({
    title,
    kind,
    rule,
    required,
    assessmentTypeId,
    classId,
    attachmentId,
    embedUrl,
    contentItemId,
    duration,
    criteria,
  })
  metaRef.current = {
    title,
    kind,
    rule,
    required,
    assessmentTypeId,
    classId,
    attachmentId,
    embedUrl,
    contentItemId,
    duration,
    criteria,
  }

  const saveMetaNow = useCallback(async () => {
    const m = metaRef.current
    const fd = new FormData()
    fd.set('title', m.title)
    fd.set('kind', m.kind)
    fd.set('completionRule', m.kind === 'practical' ? 'evaluator' : m.rule)
    fd.set('isRequired', m.required ? 'on' : 'off')
    fd.set('assessmentTypeId', m.assessmentTypeId)
    fd.set('classId', m.classId)
    fd.set('attachmentId', m.attachmentId)
    fd.set('embedUrl', m.embedUrl)
    fd.set('contentItemId', m.contentItemId)
    fd.set('durationMinutes', m.duration)
    fd.set('practicalCriteria', JSON.stringify(m.criteria))
    await updateLesson(lesson.id, courseId, fd)
  }, [courseId, lesson.id])

  const touchMeta = useCallback(() => schedule('meta', 700, saveMetaNow), [schedule, saveMetaNow])

  const saveRich = useCallback(
    (json: unknown, html: string) =>
      schedule('rich', 900, () => saveLessonRich(lesson.id, courseId, json, html)),
    [schedule, lesson.id, courseId],
  )

  const deckRef = useRef(deck)
  deckRef.current = deck
  const touchDeck = useCallback(
    (next: Slide[]) => {
      deckDirtyRef.current = true
      setDeck(next)
      schedule('slides', 1200, async () => {
        await saveLessonSlides(lesson.id, courseId, deckRef.current)
        deckDirtyRef.current = false
      })
    },
    [schedule, lesson.id, courseId],
  )

  // Convert to canvas on mount + adopt server slides (PPTX import finishing)
  // when we have no local edits.
  useEffect(() => {
    if (!deckDirtyRef.current) setDeck(ensureCanvasDeck(lesson.slides ?? []))
  }, [lesson.slides])
  const importing = lesson.importStatus === 'pending' || lesson.importStatus === 'processing'
  useEffect(() => {
    if (!importing) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [importing, router])

  function done() {
    // Flush any pending debounce immediately, then close.
    const pending = Object.keys(timers.current)
    Object.values(timers.current).forEach(clearTimeout)
    timers.current = {}
    const flushes: Promise<void>[] = []
    if (pending.includes('meta')) flushes.push(saveMetaNow())
    if (pending.includes('slides'))
      flushes.push(saveLessonSlides(lesson.id, courseId, deckRef.current).then(() => undefined))
    void Promise.all(flushes).finally(() => {
      router.refresh()
      onClose()
    })
  }

  const reusable =
    kind === 'rich' || kind === 'video' || kind === 'file' || kind === 'embed' || kind === 'slides'
  // Slides bring their own Fabric ribbon (inside SlideDeckEditor).
  const showRibbon = (kind === 'rich' || kind === 'practical') && !contentItemId

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-slate-100'
          : 'flex h-full min-h-0 flex-col bg-slate-100'
      }
    >
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />

      {/* top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <button
          type="button"
          onClick={done}
          title="Back to course content"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100"
        >
          <ArrowLeft size={16} />
        </button>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.currentTarget.value)
            touchMeta()
          }}
          placeholder="Lesson title"
          className="h-8 max-w-md flex-1 border-transparent font-semibold hover:border-slate-200"
        />
        <SaveBadge state={saveState} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={settingsOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings2 size={14} /> Settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!window.confirm('Delete this lesson?')) return
              void deleteLesson(lesson.id, courseId).then(() => {
                router.refresh()
                onClose()
              })
            }}
            aria-label="Delete lesson"
          >
            <Trash2 size={14} className="text-rose-500" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFullscreen((v) => !v)}
            aria-label="Toggle fullscreen"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button type="button" size="sm" onClick={done}>
            <Check size={14} /> Done
          </Button>
        </div>
      </div>

      {/* ribbon */}
      {showRibbon ? <LessonRibbon editor={activeEditor} /> : null}

      {/* settings strip */}
      {settingsOpen ? (
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-[11px]">Type</Label>
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.currentTarget.value as LessonKind)
                  touchMeta()
                }}
                className="h-9"
              >
                <option value="rich">Text lesson</option>
                <option value="slides">Slideshow</option>
                <option value="video">Video</option>
                <option value="file">File / handout</option>
                <option value="embed">Embedded page</option>
                <option value="quiz">Quiz</option>
                <option value="session">In-person session</option>
                <option value="practical">Practical test</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Completion</Label>
              {kind === 'practical' ? (
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500">
                  Evaluator sign-off
                </div>
              ) : (
                <Select
                  value={rule}
                  onChange={(e) => {
                    setRule(e.currentTarget.value as CompletionRule)
                    touchMeta()
                  }}
                  className="h-9"
                >
                  <option value="view">Mark as viewed</option>
                  <option value="acknowledge">Acknowledge</option>
                  <option value="pass">Pass the quiz</option>
                  <option value="min_time">Minimum time</option>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Duration (min)</Label>
              <Input
                type="number"
                min="0"
                value={duration}
                onChange={(e) => {
                  setDuration(e.currentTarget.value)
                  touchMeta()
                }}
                className="h-9"
                placeholder="optional"
              />
            </div>
            <label className="flex items-center gap-2 pt-5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => {
                  setRequired(e.currentTarget.checked)
                  touchMeta()
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              Required
            </label>
            {reusable ? (
              <div className="space-y-1">
                <Label className="text-[11px]">Reuse library item</Label>
                <Select
                  value={contentItemId}
                  onChange={(e) => {
                    setContentItemId(e.currentTarget.value)
                    touchMeta()
                  }}
                  className="h-9"
                >
                  <option value="">— inline content —</option>
                  {contentItems
                    .filter((ci) =>
                      kind === 'slides' ? ci.kind === 'slides' : ci.kind !== 'slides',
                    )
                    .map((ci) => (
                      <option key={ci.id} value={ci.id}>
                        {ci.title} ({ci.kind})
                      </option>
                    ))}
                </Select>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* body */}
      <div
        className={
          kind === 'slides' && !contentItemId
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'app-scroll min-h-0 flex-1 overflow-y-auto'
        }
      >
        {contentItemId && reusable ? (
          <CenterCard>
            <p className="text-sm text-slate-600">
              This lesson shows a library item — edit it in the{' '}
              <Link href={`/training/library/${contentItemId}`} className="text-teal-700 underline">
                Content Library
              </Link>
              .
            </p>
          </CenterCard>
        ) : kind === 'rich' ? (
          <div className="px-6 py-6">
            <div className="lesson-prose min-h-[60vh] w-full rounded-lg border border-slate-200 bg-white px-12 py-10 shadow-sm">
              <RichEditor
                initialJson={lesson.contentJson ?? undefined}
                initialHtml={lesson.contentHtml ?? blocksToHtml(lesson.contentBlocks)}
                placeholder="Write your lesson — type, paste, format with the ribbon above…"
                onChange={({ json, html }) => saveRich(json, html)}
                onFocusEditor={setActiveEditor}
              />
            </div>
          </div>
        ) : kind === 'slides' ? (
          <SlideDeckEditor
            deck={deck}
            onDeckChange={touchDeck}
            attachmentUrls={attachmentUrls}
            importStatus={lesson.importStatus}
            importError={lesson.importError}
            onImportPptx={async (attachmentId) => {
              await importLessonPptx(lesson.id, courseId, attachmentId)
              router.refresh()
            }}
            className="min-h-0 flex-1"
          />
        ) : kind === 'practical' ? (
          <div className="space-y-4 px-6 py-6">
            <div className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <Label className="mb-2 block">Sign-off criteria</Label>
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-xs text-slate-400 tabular-nums">
                      {i + 1}.
                    </span>
                    <Input
                      value={c.text}
                      onChange={(e) => {
                        const text = e.currentTarget.value
                        setCriteria((prev) => prev.map((x) => (x.id === c.id ? { ...x, text } : x)))
                        touchMeta()
                      }}
                      className="h-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove criterion"
                      onClick={() => {
                        setCriteria((prev) => prev.filter((x) => x.id !== c.id))
                        touchMeta()
                      }}
                    >
                      <Trash2 size={13} className="text-rose-500" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setCriteria((prev) => [...prev, { id: genId(), text: '' }])
                  touchMeta()
                }}
              >
                <Plus size={13} /> Add criterion
              </Button>
              <p className="mt-2 text-[11px] text-slate-500">
                Sign-offs happen under{' '}
                <Link
                  href={`/training/courses/${courseId}/evaluations`}
                  className="text-teal-700 underline"
                >
                  Evaluations
                </Link>
                .
              </p>
            </div>
            <div className="lesson-prose min-h-[40vh] w-full rounded-lg border border-slate-200 bg-white px-12 py-10 shadow-sm">
              <RichEditor
                initialJson={lesson.contentJson ?? undefined}
                initialHtml={lesson.contentHtml ?? blocksToHtml(lesson.contentBlocks)}
                placeholder="Instructions for the learner — what to prepare, where, with what equipment…"
                onChange={({ json, html }) => saveRich(json, html)}
                onFocusEditor={setActiveEditor}
              />
            </div>
          </div>
        ) : (
          <CenterCard>
            {kind === 'quiz' ? (
              <div className="space-y-1.5">
                <Label>Assessment (existing question set)</Label>
                <Select
                  value={assessmentTypeId}
                  onChange={(e) => {
                    setAssessmentTypeId(e.currentTarget.value)
                    touchMeta()
                  }}
                >
                  <option value="">— choose an assessment type —</option>
                  {assessmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-slate-500">
                  Manage question sets under Training → Assessment types.
                </p>
              </div>
            ) : kind === 'session' ? (
              <div className="space-y-1.5">
                <Label>Scheduled class</Label>
                <Select
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.currentTarget.value)
                    touchMeta()
                  }}
                >
                  <option value="">— choose a class —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </div>
            ) : kind === 'embed' ? (
              <div className="space-y-1.5">
                <Label>Embed URL</Label>
                <Input
                  value={embedUrl}
                  onChange={(e) => {
                    setEmbedUrl(e.currentTarget.value)
                    touchMeta()
                  }}
                  placeholder="https://…"
                />
              </div>
            ) : kind === 'video' ? (
              <div className="space-y-2">
                <Label>Video URL (YouTube / Vimeo / MP4)</Label>
                <Input
                  value={embedUrl}
                  onChange={(e) => {
                    setEmbedUrl(e.currentTarget.value)
                    touchMeta()
                  }}
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
                    touchMeta()
                    toast.success('Video uploaded')
                  }}
                  label="Drop a video or click to choose"
                />
                {attachmentId ? (
                  <p className="text-xs text-emerald-700">Uploaded video attached ✓</p>
                ) : null}
              </div>
            ) : kind === 'file' ? (
              <div className="space-y-2">
                <Label>Downloadable file</Label>
                <FileUploader
                  requestUploadAction={requestUpload}
                  finalizeUploadAction={finalizeUpload}
                  kind="document"
                  accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md"
                  onUploaded={(f) => {
                    setAttachmentId(f.attachmentId)
                    touchMeta()
                    toast.success('File attached')
                  }}
                  label="Drop a PDF / handout or click to choose"
                />
                {attachmentId ? <p className="text-xs text-emerald-700">File attached ✓</p> : null}
              </div>
            ) : null}
          </CenterCard>
        )}
      </div>
    </div>
  )
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-8">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        state === 'saved' && 'bg-emerald-50 text-emerald-700',
        state === 'saving' && 'bg-sky-50 text-sky-700',
        state === 'dirty' && 'bg-amber-50 text-amber-700',
      )}
    >
      {state === 'saving' ? <Loader2 size={10} className="animate-spin" /> : null}
      {state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Unsaved'}
    </span>
  )
}
