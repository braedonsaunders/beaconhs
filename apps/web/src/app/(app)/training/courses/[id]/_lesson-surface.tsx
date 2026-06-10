'use client'

// The lesson editor surface — fills the right 2/3 of the course builder when a
// lesson is open (fullscreen optional). Documents-editor conventions: slim top
// bar, Office-style ribbon, direct inline WYSIWYG editing on the content
// itself (TipTap pages, editable slide canvas), autosave with a save badge.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Editor } from '@tiptap/react'
import { Reorder } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  Copy,
  FileUp,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { Badge, Button, FileUploader, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import {
  isRichRegion,
  type PracticalCriterion,
  type Slide,
  type SlideRegion,
} from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { RichEditor } from '../../_editor/rich-editor'
import { LessonRibbon } from '../../_editor/ribbon'
import { lessonProseCss } from '../../_editor/prose'
import { blocksToHtml } from '../../_editor/legacy'
import { SlideThumb } from '../../_components/slide-view'
import { SlidePlayer } from '../../_components/slide-player'
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

const LAYOUTS: { value: Slide['layout']; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'title-content', label: 'Title + content' },
  { value: 'two-col', label: 'Two columns' },
  { value: 'image-text', label: 'Image + text' },
  { value: 'image-full', label: 'Full image' },
]
const BGS: { value: NonNullable<Slide['bg']>; swatch: string }[] = [
  { value: 'white', swatch: 'bg-white border-slate-300' },
  { value: 'slate', swatch: 'bg-slate-200 border-slate-300' },
  { value: 'teal', swatch: 'bg-teal-900 border-teal-900' },
  { value: 'dark', swatch: 'bg-slate-900 border-slate-900' },
]
const SLIDE_BG: Record<NonNullable<Slide['bg']>, string> = {
  white: 'bg-white text-slate-900',
  slate: 'bg-slate-100 text-slate-900',
  teal: 'bg-teal-900 text-white',
  dark: 'bg-slate-900 text-white',
}

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

  // --- slides deck (autosaved) ---
  const [deck, setDeck] = useState<Slide[]>(lesson.slides ?? [])
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(lesson.slides?.[0]?.id ?? null)
  const deckDirtyRef = useRef(false)
  const [showImport, setShowImport] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({})
  const urls = { ...attachmentUrls, ...localUrls }

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

  const metaRef = useRef({ title, kind, rule, required, assessmentTypeId, classId, attachmentId, embedUrl, contentItemId, duration, criteria })
  metaRef.current = { title, kind, rule, required, assessmentTypeId, classId, attachmentId, embedUrl, contentItemId, duration, criteria }

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

  // Adopt server slides (PPTX import finishing) when we have no local edits.
  useEffect(() => {
    if (!deckDirtyRef.current) {
      setDeck(lesson.slides ?? [])
      setSelectedSlideId((cur) =>
        cur && (lesson.slides ?? []).some((s) => s.id === cur) ? cur : lesson.slides?.[0]?.id ?? null,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (pending.includes('slides')) flushes.push(saveLessonSlides(lesson.id, courseId, deckRef.current).then(() => undefined))
    void Promise.all(flushes).finally(() => {
      router.refresh()
      onClose()
    })
  }

  const selectedSlide = deck.find((s) => s.id === selectedSlideId) ?? null
  function patchSlide(id: string, patch: Partial<Slide>) {
    touchDeck(deck.map((s) => (s.id === id ? ({ ...s, ...patch } as Slide) : s)))
  }

  const reusable =
    kind === 'rich' || kind === 'video' || kind === 'file' || kind === 'embed' || kind === 'slides'
  const showRibbon = (kind === 'rich' || kind === 'practical' || kind === 'slides') && !contentItemId

  // Slide ribbon controls
  const slideControls =
    kind === 'slides' && !contentItemId ? (
      <>
        <Select
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value as Slide['layout'] | ''
            if (!v) return
            const slide: Slide = { id: genId(), layout: v, bg: 'white' }
            const i = selectedSlideId ? deck.findIndex((s) => s.id === selectedSlideId) : deck.length - 1
            const next = [...deck]
            next.splice(i + 1, 0, slide)
            touchDeck(next)
            setSelectedSlideId(slide.id)
            e.currentTarget.value = ''
          }}
          className="h-7 w-36 text-xs"
        >
          <option value="">+ Add slide…</option>
          {LAYOUTS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        {selectedSlide && selectedSlide.layout !== 'pptx' ? (
          <span className="flex items-center gap-1">
            {BGS.map((b) => (
              <button
                key={b.value}
                type="button"
                title={`Background: ${b.value}`}
                onClick={() => patchSlide(selectedSlide.id, { bg: b.value })}
                className={cn(
                  'h-5 w-5 rounded-full border',
                  b.swatch,
                  (selectedSlide.bg ?? 'white') === b.value && 'ring-2 ring-teal-500 ring-offset-1',
                )}
              />
            ))}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selectedSlide}
          onClick={() => {
            if (!selectedSlide) return
            const copy: Slide = { ...selectedSlide, id: genId() }
            const i = deck.findIndex((s) => s.id === selectedSlide.id)
            const next = [...deck]
            next.splice(i + 1, 0, copy)
            touchDeck(next)
            setSelectedSlideId(copy.id)
          }}
        >
          <Copy size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selectedSlide}
          onClick={() => {
            if (!selectedSlide) return
            const i = deck.findIndex((s) => s.id === selectedSlide.id)
            const next = deck.filter((s) => s.id !== selectedSlide.id)
            touchDeck(next)
            setSelectedSlideId(next[Math.min(i, next.length - 1)]?.id ?? null)
          }}
        >
          <Trash2 size={13} className="text-rose-500" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
          <FileUp size={13} /> Import
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={deck.length === 0} onClick={() => setPresenting(true)}>
          <Play size={13} /> Present
        </Button>
        {importing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
            <Loader2 size={11} className="animate-spin" /> importing…
          </span>
        ) : lesson.importStatus === 'failed' ? (
          <span className="inline-flex max-w-[14rem] items-center truncate rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700" title={lesson.importError ?? undefined}>
            import failed
          </span>
        ) : null}
      </>
    ) : null

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
      {showRibbon ? <LessonRibbon editor={activeEditor} extra={slideControls} /> : null}

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
                    .filter((ci) => (kind === 'slides' ? ci.kind === 'slides' : ci.kind !== 'slides'))
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
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
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
          <div className="flex gap-4 px-5 py-5">
            {/* filmstrip */}
            <div className="w-40 shrink-0">
              <Reorder.Group
                axis="y"
                values={deck}
                onReorder={(next) => touchDeck(next as Slide[])}
                as="ul"
                className="app-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1"
              >
                {deck.map((s, i) => (
                  <Reorder.Item key={s.id} value={s} as="li" className="cursor-grab active:cursor-grabbing">
                    <button
                      type="button"
                      onClick={() => setSelectedSlideId(s.id)}
                      className={cn(
                        'block w-full rounded-md p-0.5 text-left',
                        s.id === selectedSlideId ? 'ring-2 ring-teal-500' : 'hover:ring-2 hover:ring-slate-300',
                      )}
                    >
                      <SlideThumb slide={s} attachmentUrls={urls} />
                      <span className="mt-0.5 block px-1 text-[10px] tabular-nums text-slate-400">{i + 1}</span>
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
              {deck.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
                  Add a slide or import a PowerPoint (ribbon ↑).
                </p>
              ) : null}
            </div>

            {/* canvas */}
            <div className="min-w-0 flex-1 space-y-3">
              {showImport ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <FileUploader
                    requestUploadAction={requestUpload}
                    finalizeUploadAction={finalizeUpload}
                    kind="document"
                    accept=".pptx,.ppt"
                    onUploaded={(f) => {
                      setShowImport(false)
                      void importLessonPptx(lesson.id, courseId, f.attachmentId).then(() => {
                        toast.success('PowerPoint queued — slides appear here when converted')
                        router.refresh()
                      })
                    }}
                    label="Drop a .pptx or click to choose"
                    hint="Slides arrive as pixel-perfect images (speaker notes preserved)."
                  />
                </div>
              ) : null}
              {selectedSlide ? (
                <>
                  <SlideCanvas
                    key={selectedSlide.id}
                    slide={selectedSlide}
                    attachmentUrls={urls}
                    onPatch={(patch) => patchSlide(selectedSlide.id, patch)}
                    onFocusEditor={setActiveEditor}
                    onLocalUrl={(id, url) => setLocalUrls((p) => ({ ...p, [id]: url }))}
                  />
                  <Textarea
                    rows={2}
                    value={selectedSlide.notes ?? ''}
                    onChange={(e) => patchSlide(selectedSlide.id, { notes: e.currentTarget.value })}
                    placeholder="Speaker / learner notes for this slide"
                    className="bg-white"
                  />
                </>
              ) : (
                <div className="grid aspect-[16/9] place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-sm text-slate-400">
                  Add your first slide from the ribbon.
                </div>
              )}
            </div>
          </div>
        ) : kind === 'practical' ? (
          <div className="space-y-4 px-6 py-6">
            <div className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <Label className="mb-2 block">Sign-off criteria</Label>
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-xs tabular-nums text-slate-400">{i + 1}.</span>
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
                <Link href={`/training/courses/${courseId}/evaluations`} className="text-teal-700 underline">
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
                {attachmentId ? <p className="text-xs text-emerald-700">Uploaded video attached ✓</p> : null}
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

      {/* present overlay */}
      {presenting ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black">
          <button
            type="button"
            onClick={() => setPresenting(false)}
            aria-label="Close presentation"
            className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={18} />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="w-full max-w-[177.78vh]">
              <SlidePlayer slides={deck} attachmentUrls={urls} />
            </div>
          </div>
        </div>
      ) : null}
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

// --- Editable slide canvas -----------------------------------------------------

function regionHtml(r: SlideRegion | undefined): string {
  if (!r) return ''
  if (isRichRegion(r)) return r.html
  return blocksToHtml(r)
}

function SlideCanvas({
  slide,
  attachmentUrls,
  onPatch,
  onFocusEditor,
  onLocalUrl,
}: {
  slide: Slide
  attachmentUrls: Record<string, string | null | undefined>
  onPatch: (patch: Partial<Slide>) => void
  onFocusEditor: (e: Editor) => void
  onLocalUrl: (attachmentId: string, url: string) => void
}) {
  const bg = SLIDE_BG[slide.bg ?? 'white']
  const isDark = slide.bg === 'teal' || slide.bg === 'dark'
  const imgUrl = slide.imageAttachmentId ? attachmentUrls[slide.imageAttachmentId] : null

  const region = (key: 'body' | 'left' | 'right', placeholder: string) => (
    <div className="slide-rich min-h-[2em]">
      <RichEditor
        initialHtml={regionHtml(slide[key])}
        placeholder={placeholder}
        onChange={({ json, html }) => onPatch({ [key]: { json, html } } as Partial<Slide>)}
        onFocusEditor={onFocusEditor}
      />
    </div>
  )

  const titleInput = (cls: string, placeholder = 'Slide title') => (
    <input
      value={slide.title ?? ''}
      onChange={(e) => onPatch({ title: e.currentTarget.value })}
      placeholder={placeholder}
      className={cn('w-full border-none bg-transparent outline-none placeholder:opacity-40', cls)}
    />
  )
  const subtitleInput = (cls: string) => (
    <input
      value={slide.subtitle ?? ''}
      onChange={(e) => onPatch({ subtitle: e.currentTarget.value })}
      placeholder="Subtitle (optional)"
      className={cn('w-full border-none bg-transparent outline-none placeholder:opacity-40', cls)}
    />
  )

  const imageRegion = (cover: boolean) => (
    <ImageDrop
      url={imgUrl ?? null}
      cover={cover}
      onUploaded={(attachmentId, url) => {
        onLocalUrl(attachmentId, url)
        onPatch({ imageAttachmentId: attachmentId })
      }}
    />
  )

  return (
    <div className={cn('relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-slate-200 shadow-sm', bg)}>
      {slide.layout === 'pptx' ? (
        imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-slate-400">Slide image unavailable</div>
        )
      ) : null}

      {slide.layout === 'title' ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-[8%] text-center">
          {titleInput('text-center text-[clamp(1.4rem,4.5cqw,3rem)] font-bold leading-tight')}
          {subtitleInput(cn('text-center text-[clamp(0.85rem,2.2cqw,1.4rem)]', isDark ? 'text-white/70' : 'text-slate-500'))}
        </div>
      ) : null}

      {slide.layout === 'title-content' ? (
        <div className="flex h-full flex-col gap-3 px-[7%] py-[6%]">
          {titleInput('text-[clamp(1.1rem,3cqw,2rem)] font-bold leading-tight')}
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto">{region('body', 'Add content…')}</div>
        </div>
      ) : null}

      {slide.layout === 'two-col' ? (
        <div className="flex h-full flex-col gap-3 px-[7%] py-[6%]">
          {titleInput('text-[clamp(1.1rem,3cqw,2rem)] font-bold leading-tight')}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[5%] overflow-hidden">
            <div className="app-scroll overflow-y-auto">{region('left', 'Left column…')}</div>
            <div className="app-scroll overflow-y-auto">{region('right', 'Right column…')}</div>
          </div>
        </div>
      ) : null}

      {slide.layout === 'image-text' ? (
        <div className="grid h-full grid-cols-2">
          <div className="relative h-full overflow-hidden">{imageRegion(true)}</div>
          <div className="flex h-full flex-col gap-2 overflow-hidden px-[8%] py-[8%]">
            {titleInput('text-[clamp(1rem,2.6cqw,1.7rem)] font-bold leading-tight')}
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto">{region('body', 'Add content…')}</div>
          </div>
        </div>
      ) : null}

      {slide.layout === 'image-full' ? (
        <>
          <div className="absolute inset-0">{imageRegion(true)}</div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-[7%] pb-[5%] pt-[10%]">
            {titleInput('text-[clamp(1rem,3cqw,2rem)] font-bold leading-tight text-white placeholder:text-white/40')}
            {subtitleInput('text-[clamp(0.75rem,1.8cqw,1.1rem)] text-white/80 placeholder:text-white/40')}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ImageDrop({
  url,
  cover,
  onUploaded,
}: {
  url: string | null
  cover: boolean
  onUploaded: (attachmentId: string, publicUrl: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="group relative block h-full w-full"
      title="Click to set image"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={cn('h-full w-full', cover ? 'object-cover' : 'object-contain')} />
      ) : (
        <span className="grid h-full w-full place-items-center bg-slate-200 text-xs text-slate-500">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Click to add an image'}
        </span>
      )}
      <span className="absolute inset-0 hidden place-items-center bg-black/40 text-xs font-medium text-white group-hover:grid">
        {busy ? <Loader2 size={16} className="animate-spin" /> : 'Replace image'}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={async (ev) => {
          const file = ev.currentTarget.files?.[0]
          ev.currentTarget.value = ''
          if (!file) return
          setBusy(true)
          try {
            const req = await requestUpload({
              kind: 'image',
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
            })
            if (!req.ok) throw new Error(req.error)
            await fetch(req.putUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
            const fin = await finalizeUpload({
              key: req.key,
              kind: 'image',
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
            })
            if (!fin.ok) throw new Error(fin.error)
            onUploaded(fin.attachmentId, req.publicUrl)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Image upload failed')
          } finally {
            setBusy(false)
          }
        }}
      />
    </button>
  )
}
