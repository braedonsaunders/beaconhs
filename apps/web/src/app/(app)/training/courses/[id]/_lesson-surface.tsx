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
import type { PracticalCriterion } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { RichEditor } from '../../_editor/rich-editor'
import { LessonRibbon } from '../../_editor/ribbon'
import { lessonProseCss } from '../../_editor/prose'
import { SlideDeckEditor } from '../../_editor/slide-deck-editor'
import { LatestAutosaveQueue, type AutosaveSnapshot } from './_lib/autosave-queue'
import type { CompletionRule, LessonKind, LessonLite } from './_workspace'
import { deleteLesson, importLessonPptx, saveLessonRich, updateLesson } from './studio/_actions'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export type LessonSaveController = {
  hasWork: () => boolean
  flush: () => Promise<void>
  flushAndPause: () => Promise<void>
  resume: () => void
}

const genId = () => globalThis.crypto.randomUUID()

export function LessonSurface({
  courseId,
  lesson,
  assessmentTypes,
  classes,
  contentItems,
  attachmentUrls,
  onClose,
  onSaveControllerChange,
}: {
  courseId: string
  lesson: LessonLite
  assessmentTypes: { id: string; name: string }[]
  classes: { id: string; title: string }[]
  contentItems: { id: string; title: string; kind: string }[]
  attachmentUrls: Record<string, string | null | undefined>
  onClose: () => void
  onSaveControllerChange: (controller: LessonSaveController | null) => void
}) {
  const router = useRouter()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [saveQueue] = useState(() => new LatestAutosaveQueue())
  const [saveSnapshot, setSaveSnapshot] = useState<AutosaveSnapshot>({
    state: 'saved',
    error: null,
  })
  const [terminalAction, setTerminalAction] = useState<
    'closing' | 'deleting' | 'navigating' | null
  >(null)
  const terminalRef = useRef(false)

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
  const [minimumMinutes, setMinimumMinutes] = useState(
    lesson.minTimeSeconds ? Math.ceil(lesson.minTimeSeconds / 60).toString() : '',
  )
  const [criteria, setCriteria] = useState<PracticalCriterion[]>(lesson.practicalCriteria ?? [])
  const selectedAssessmentType = assessmentTypes.find((type) => type.id === assessmentTypeId)
  const selectedClass = classes.find((scheduledClass) => scheduledClass.id === classId)
  const selectedContentItem = contentItems.find((item) => item.id === contentItemId)

  // --- debounced autosave plumbing ---
  useEffect(() => saveQueue.subscribe(setSaveSnapshot), [saveQueue])

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
    minimumMinutes,
    criteria,
  })
  useEffect(() => {
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
      minimumMinutes,
      criteria,
    }
  }, [
    assessmentTypeId,
    attachmentId,
    classId,
    contentItemId,
    criteria,
    duration,
    embedUrl,
    kind,
    minimumMinutes,
    required,
    rule,
    title,
  ])

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
    fd.set('minimumMinutes', m.minimumMinutes)
    fd.set('practicalCriteria', JSON.stringify(m.criteria))
    await updateLesson(lesson.id, courseId, fd)
  }, [courseId, lesson.id])

  const touchMeta = useCallback(
    (patch: Partial<(typeof metaRef)['current']>) => {
      metaRef.current = { ...metaRef.current, ...patch }
      saveQueue.schedule('meta', 700, saveMetaNow)
    },
    [saveMetaNow, saveQueue],
  )

  const saveRich = useCallback(
    (html: string) =>
      saveQueue.schedule('rich', 900, () => saveLessonRich(lesson.id, courseId, html)),
    [courseId, lesson.id, saveQueue],
  )

  const blurEditor = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && surfaceRef.current?.contains(active)) active.blur()
  }, [])

  const reportSaveFailure = useCallback((error: unknown) => {
    toast.error(error instanceof Error ? error.message : 'Changes could not be saved.')
  }, [])

  const retrySave = useCallback(async () => {
    try {
      await saveQueue.retry()
    } catch (error) {
      reportSaveFailure(error)
    }
  }, [reportSaveFailure, saveQueue])

  const flushForNavigation = useCallback(async () => {
    terminalRef.current = true
    setTerminalAction('navigating')
    blurEditor()
    try {
      await saveQueue.flushAndPause()
    } catch (error) {
      saveQueue.resume()
      terminalRef.current = false
      setTerminalAction(null)
      throw error
    }
  }, [blurEditor, saveQueue])

  const resumeAfterNavigation = useCallback(() => {
    saveQueue.resume()
    terminalRef.current = false
    setTerminalAction(null)
  }, [saveQueue])

  useEffect(() => {
    onSaveControllerChange({
      hasWork: () => saveQueue.hasWork(),
      flush: () => saveQueue.flush(),
      flushAndPause: flushForNavigation,
      resume: resumeAfterNavigation,
    })
    return () => onSaveControllerChange(null)
  }, [flushForNavigation, onSaveControllerChange, resumeAfterNavigation, saveQueue])

  const done = useCallback(async () => {
    if (terminalRef.current) return
    terminalRef.current = true
    setTerminalAction('closing')
    blurEditor()
    try {
      await saveQueue.flushAndPause()
      router.refresh()
      onClose()
    } catch (error) {
      saveQueue.resume()
      terminalRef.current = false
      setTerminalAction(null)
      reportSaveFailure(error)
    }
  }, [blurEditor, onClose, reportSaveFailure, router, saveQueue])

  const removeLesson = useCallback(async () => {
    if (terminalRef.current) return
    if (!(await confirmDialog({ message: 'Delete this lesson?', tone: 'danger' }))) return
    terminalRef.current = true
    setTerminalAction('deleting')
    blurEditor()
    await saveQueue.pauseAndWait()
    try {
      await deleteLesson(lesson.id, courseId)
      router.refresh()
      onClose()
    } catch (error) {
      saveQueue.resume()
      terminalRef.current = false
      setTerminalAction(null)
      reportSaveFailure(error)
      void saveQueue.retry().catch(reportSaveFailure)
    }
  }, [blurEditor, courseId, lesson.id, onClose, reportSaveFailure, router, saveQueue])

  const reusable =
    kind === 'rich' || kind === 'video' || kind === 'file' || kind === 'embed' || kind === 'slides'
  // Slides bring their own toolbar (the PowerPoint editor inside SlideDeckEditor).
  const showRibbon = (kind === 'rich' || kind === 'practical') && !contentItemId

  return (
    <div
      ref={surfaceRef}
      aria-busy={terminalAction !== null}
      onBlurCapture={() => {
        if (terminalRef.current) return
        void saveQueue.flush().catch(reportSaveFailure)
      }}
      className={cn(
        'relative',
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950'
          : 'flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950',
      )}
    >
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />
      {terminalAction ? (
        <div className="absolute inset-0 z-[60] cursor-wait" role="status" aria-live="polite">
          <span className="sr-only">
            {terminalAction === 'deleting' ? 'Deleting lesson…' : 'Saving lesson changes…'}
          </span>
        </div>
      ) : null}

      {/* top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => void done()}
          disabled={terminalAction !== null}
          title="Back to course content"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={16} />
        </button>
        <Input
          value={title}
          onChange={(e) => {
            const nextTitle = e.currentTarget.value
            setTitle(nextTitle)
            touchMeta({ title: nextTitle })
          }}
          placeholder="Lesson title"
          className="h-8 max-w-md flex-1 border-transparent font-semibold hover:border-slate-200 dark:hover:border-slate-700"
        />
        <SaveBadge snapshot={saveSnapshot} onRetry={() => void retrySave()} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={settingsOpen ? 'default' : 'outline'}
            size="sm"
            disabled={terminalAction !== null}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings2 size={14} /> Settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={terminalAction !== null}
            onClick={() => void removeLesson()}
            aria-label="Delete lesson"
          >
            {terminalAction === 'deleting' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} className="text-rose-500" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={terminalAction !== null}
            onClick={() => setFullscreen((v) => !v)}
            aria-label="Toggle fullscreen"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={terminalAction !== null}
            onClick={() => void done()}
          >
            {terminalAction === 'closing' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}{' '}
            Done
          </Button>
        </div>
      </div>

      {/* ribbon */}
      {showRibbon ? <LessonRibbon editor={activeEditor} /> : null}

      {/* settings strip */}
      {settingsOpen ? (
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-[11px]">Type</Label>
              <Select
                value={kind}
                onChange={(e) => {
                  const nextKind = e.currentTarget.value as LessonKind
                  const patch: Partial<(typeof metaRef)['current']> = { kind: nextKind }
                  setKind(nextKind)
                  if (nextKind === 'quiz') {
                    setRule('pass')
                    patch.rule = 'pass'
                  } else if (rule === 'pass') {
                    setRule('view')
                    patch.rule = 'view'
                  }
                  if ((nextKind === 'slides') !== (kind === 'slides')) {
                    setContentItemId('')
                    patch.contentItemId = ''
                  }
                  touchMeta(patch)
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
              {kind === 'practical' || kind === 'quiz' ? (
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {kind === 'practical' ? 'Evaluator sign-off' : 'Pass quiz'}
                </div>
              ) : (
                <Select
                  value={rule}
                  onChange={(e) => {
                    const nextRule = e.currentTarget.value as CompletionRule
                    const patch: Partial<(typeof metaRef)['current']> = { rule: nextRule }
                    setRule(nextRule)
                    if (nextRule === 'min_time' && !minimumMinutes) {
                      setMinimumMinutes('1')
                      patch.minimumMinutes = '1'
                    }
                    touchMeta(patch)
                  }}
                  className="h-9"
                >
                  <option value="view">Mark as viewed</option>
                  <option value="acknowledge">Acknowledge</option>
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
                  const nextDuration = e.currentTarget.value
                  setDuration(nextDuration)
                  touchMeta({ duration: nextDuration })
                }}
                className="h-9"
                placeholder="optional"
              />
            </div>
            {rule === 'min_time' && kind !== 'practical' ? (
              <div className="space-y-1">
                <Label className="text-[11px]">Minimum time (min)</Label>
                <Input
                  type="number"
                  min="1"
                  value={minimumMinutes}
                  onChange={(e) => {
                    const nextMinimum = e.currentTarget.value
                    setMinimumMinutes(nextMinimum)
                    touchMeta({ minimumMinutes: nextMinimum })
                  }}
                  className="h-9"
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 pt-5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => {
                  const nextRequired = e.currentTarget.checked
                  setRequired(nextRequired)
                  touchMeta({ required: nextRequired })
                }}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
              />
              Required
            </label>
            {reusable ? (
              <div className="space-y-1">
                <Label className="text-[11px]">Reuse library item</Label>
                <RemoteSearchSelect
                  lookup={
                    kind === 'slides'
                      ? 'training-course-library-slides'
                      : 'training-course-library-content'
                  }
                  value={contentItemId}
                  onChange={(value) => {
                    setContentItemId(value)
                    touchMeta({ contentItemId: value })
                  }}
                  initialOption={
                    selectedContentItem
                      ? { value: selectedContentItem.id, label: selectedContentItem.title }
                      : undefined
                  }
                  placeholder="Inline content"
                  emptyLabel="Inline content"
                  searchPlaceholder="Search the training library…"
                  sheetTitle="Reuse library item"
                  clearable
                />
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
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This lesson shows a library item — edit it in the{' '}
              <Link
                href={`/training/library/${contentItemId}`}
                className="text-teal-700 underline dark:text-teal-300"
              >
                Content Library
              </Link>
              .
            </p>
          </CenterCard>
        ) : kind === 'rich' ? (
          <div className="px-6 py-6">
            <div className="lesson-prose min-h-[60vh] w-full rounded-lg border border-slate-200 bg-white px-12 py-10 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <RichEditor
                initialHtml={lesson.contentHtml}
                placeholder="Write your lesson — type, paste, format with the ribbon above…"
                onChange={({ html }) => saveRich(html)}
                onFocusEditor={setActiveEditor}
              />
            </div>
          </div>
        ) : kind === 'slides' ? (
          <SlideDeckEditor
            onImportPptx={async (attachmentId) => {
              await saveQueue.flush()
              await importLessonPptx(lesson.id, courseId, attachmentId)
              router.refresh()
            }}
            target="lesson"
            targetId={lesson.id}
            beforeDeckMutation={() => saveQueue.flush()}
            master={
              lesson.sourceAttachmentId
                ? {
                    attachmentId: lesson.sourceAttachmentId,
                    filename: lesson.sourceFilename ?? 'PowerPoint file',
                  }
                : null
            }
            className="min-h-0 flex-1"
          />
        ) : kind === 'practical' ? (
          <div className="space-y-4 px-6 py-6">
            <div className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <Label className="mb-2 block">Sign-off criteria</Label>
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-xs text-slate-400 tabular-nums dark:text-slate-500">
                      {i + 1}.
                    </span>
                    <Input
                      value={c.text}
                      onChange={(e) => {
                        const text = e.currentTarget.value
                        const nextCriteria = criteria.map((item) =>
                          item.id === c.id ? { ...item, text } : item,
                        )
                        setCriteria(nextCriteria)
                        touchMeta({ criteria: nextCriteria })
                      }}
                      className="h-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove criterion"
                      onClick={() => {
                        const nextCriteria = criteria.filter((item) => item.id !== c.id)
                        setCriteria(nextCriteria)
                        touchMeta({ criteria: nextCriteria })
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
                  const nextCriteria = [...criteria, { id: genId(), text: '' }]
                  setCriteria(nextCriteria)
                  touchMeta({ criteria: nextCriteria })
                }}
              >
                <Plus size={13} /> Add criterion
              </Button>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Sign-offs happen under{' '}
                <Link
                  href={`/training/courses/${courseId}/evaluations`}
                  className="text-teal-700 underline dark:text-teal-300"
                >
                  Evaluations
                </Link>
                .
              </p>
            </div>
            <div className="lesson-prose min-h-[40vh] w-full rounded-lg border border-slate-200 bg-white px-12 py-10 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <RichEditor
                initialHtml={lesson.contentHtml}
                placeholder="Instructions for the learner — what to prepare, where, with what equipment…"
                onChange={({ html }) => saveRich(html)}
                onFocusEditor={setActiveEditor}
              />
            </div>
          </div>
        ) : (
          <CenterCard>
            {kind === 'quiz' ? (
              <div className="space-y-1.5">
                <Label>Assessment (existing question set)</Label>
                <RemoteSearchSelect
                  lookup="training-course-assessment-types"
                  value={assessmentTypeId}
                  onChange={(value) => {
                    setAssessmentTypeId(value)
                    touchMeta({ assessmentTypeId: value })
                  }}
                  initialOption={
                    selectedAssessmentType
                      ? { value: selectedAssessmentType.id, label: selectedAssessmentType.name }
                      : undefined
                  }
                  placeholder="Choose an assessment type…"
                  emptyLabel="No assessment type"
                  searchPlaceholder="Search assessment types…"
                  sheetTitle="Assessment type"
                  clearable
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Manage question sets under Training → Assessment types.
                </p>
              </div>
            ) : kind === 'session' ? (
              <div className="space-y-1.5">
                <Label>Scheduled class</Label>
                <RemoteSearchSelect
                  lookup="training-course-classes"
                  contextId={courseId}
                  value={classId}
                  onChange={(value) => {
                    setClassId(value)
                    touchMeta({ classId: value })
                  }}
                  initialOption={
                    selectedClass
                      ? { value: selectedClass.id, label: selectedClass.title }
                      : undefined
                  }
                  placeholder="Choose a class…"
                  emptyLabel="No scheduled class"
                  searchPlaceholder="Search scheduled classes…"
                  sheetTitle="Scheduled class"
                  clearable
                />
              </div>
            ) : kind === 'embed' ? (
              <div className="space-y-1.5">
                <Label>Embed URL</Label>
                <Input
                  value={embedUrl}
                  onChange={(e) => {
                    const nextUrl = e.currentTarget.value
                    setEmbedUrl(nextUrl)
                    touchMeta({ embedUrl: nextUrl })
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
                    const nextUrl = e.currentTarget.value
                    setEmbedUrl(nextUrl)
                    touchMeta({ embedUrl: nextUrl })
                  }}
                  placeholder="https://…"
                />
                <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                  — or upload —
                </p>
                <FileUploader
                  requestUploadAction={requestUpload}
                  finalizeUploadAction={finalizeUpload}
                  kind="video"
                  accept=".mp4,.mov,.webm"
                  onUploaded={(f) => {
                    setAttachmentId(f.attachmentId)
                    setEmbedUrl('')
                    touchMeta({ attachmentId: f.attachmentId, embedUrl: '' })
                    toast.success('Video uploaded')
                  }}
                  label="Drop a video or click to choose"
                />
                {attachmentId ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Uploaded video attached ✓
                  </p>
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
                    touchMeta({ attachmentId: f.attachmentId })
                    toast.success('File attached')
                  }}
                  label="Drop a PDF / handout or click to choose"
                />
                {attachmentId ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">File attached ✓</p>
                ) : null}
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
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </div>
  )
}

function SaveBadge({ snapshot, onRetry }: { snapshot: AutosaveSnapshot; onRetry: () => void }) {
  const { state, error } = snapshot
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? 'Save failed.'}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:underline dark:bg-red-950/40 dark:text-red-300"
      >
        Not saved — retry
      </button>
    )
  }
  return (
    <span
      aria-live="polite"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        state === 'saved' &&
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        state === 'saving' && 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
        state === 'dirty' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      )}
    >
      {state === 'saving' ? <Loader2 size={10} className="animate-spin" /> : null}
      {state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Unsaved'}
    </span>
  )
}
