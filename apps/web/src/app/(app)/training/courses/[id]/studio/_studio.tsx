'use client'

// Authoring Studio shell — the curriculum tree (modules → lessons) plus a lesson
// editor drawer. Server-truth driven: mutations call server actions whose
// revalidatePath re-renders this tree with fresh props.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Video,
} from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select } from '@beaconhs/ui'
import type { LessonBlock } from '@beaconhs/db/schema'
import { FileUploader, Card, CardContent } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { BlockEditor } from './_block-editor'
import {
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  reorderLessons,
  reorderModules,
  saveLessonContent,
  updateLesson,
  updateModule,
} from './_actions'

export type LessonLite = {
  id: string
  moduleId: string
  title: string
  kind: 'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session'
  isRequired: boolean
  completionRule: 'view' | 'pass' | 'acknowledge' | 'min_time'
  assessmentTypeId: string | null
  classId: string | null
  attachmentId: string | null
  embedUrl: string | null
  durationMinutes: number | null
  contentBlocks: LessonBlock[]
}
export type ModuleLite = {
  id: string
  title: string
  description: string | null
  lessons: LessonLite[]
}

const KIND_META: Record<LessonLite['kind'], { label: string; icon: React.ReactNode }> = {
  rich: { label: 'Lesson', icon: <FileText size={13} /> },
  video: { label: 'Video', icon: <Video size={13} /> },
  file: { label: 'File', icon: <FileText size={13} /> },
  embed: { label: 'Embed', icon: <Link2 size={13} /> },
  quiz: { label: 'Quiz', icon: <ClipboardCheck size={13} /> },
  session: { label: 'In-person', icon: <GraduationCap size={13} /> },
}

export function CurriculumStudio({
  courseId,
  modules,
  assessmentTypes,
  classes,
}: {
  courseId: string
  modules: ModuleLite[]
  assessmentTypes: { id: string; name: string }[]
  classes: { id: string; title: string }[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<LessonLite | null>(null)
  const [, startTransition] = useTransition()

  function moveModule(index: number, dir: -1 | 1) {
    const next = [...modules]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    startTransition(async () => {
      await reorderModules(courseId, next.map((m) => m.id))
      router.refresh()
    })
  }
  function moveLesson(mod: ModuleLite, index: number, dir: -1 | 1) {
    const next = [...mod.lessons]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    startTransition(async () => {
      await reorderLessons(courseId, next.map((l) => l.id))
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {modules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-slate-500">
              This course has no curriculum yet. Add your first module to start building.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {modules.map((mod, mi) => (
        <Card key={mod.id}>
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-3">
            <ModuleTitle courseId={courseId} mod={mod} />
            <div className="flex shrink-0 items-center gap-0.5">
              <Button type="button" variant="ghost" size="sm" disabled={mi === 0} onClick={() => moveModule(mi, -1)} aria-label="Move module up">
                <ArrowUp size={14} />
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={mi === modules.length - 1} onClick={() => moveModule(mi, 1)} aria-label="Move module down">
                <ArrowDown size={14} />
              </Button>
              <form action={deleteModule.bind(null, mod.id, courseId)}>
                <Button type="submit" variant="ghost" size="sm" aria-label="Delete module">
                  <Trash2 size={14} className="text-rose-500" />
                </Button>
              </form>
            </div>
          </div>

          <CardContent className="space-y-1.5 p-3">
            {mod.lessons.length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-400">No lessons in this module yet.</p>
            ) : (
              mod.lessons.map((lesson, li) => (
                <div
                  key={lesson.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="text-slate-400">{KIND_META[lesson.kind].icon}</span>
                  <button
                    type="button"
                    onClick={() => setEditing(lesson)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 hover:text-teal-700"
                  >
                    {lesson.title}
                  </button>
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {KIND_META[lesson.kind].label}
                  </Badge>
                  {!lesson.isRequired ? (
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      optional
                    </Badge>
                  ) : null}
                  <div className="flex items-center gap-0.5">
                    <Button type="button" variant="ghost" size="sm" disabled={li === 0} onClick={() => moveLesson(mod, li, -1)} aria-label="Move lesson up">
                      <ArrowUp size={13} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={li === mod.lessons.length - 1} onClick={() => moveLesson(mod, li, 1)} aria-label="Move lesson down">
                      <ArrowDown size={13} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(lesson)} aria-label="Edit lesson">
                      <Pencil size={13} />
                    </Button>
                    <form action={deleteLesson.bind(null, lesson.id, courseId)}>
                      <Button type="submit" variant="ghost" size="sm" aria-label="Delete lesson">
                        <Trash2 size={13} className="text-rose-500" />
                      </Button>
                    </form>
                  </div>
                </div>
              ))
            )}

            <form action={createLesson.bind(null, courseId, mod.id)} className="flex items-center gap-2 pt-1">
              <Input name="title" placeholder="New lesson title" className="h-9" required />
              <Select name="kind" defaultValue="rich" className="h-9 w-32">
                <option value="rich">Lesson</option>
                <option value="video">Video</option>
                <option value="file">File</option>
                <option value="embed">Embed</option>
                <option value="quiz">Quiz</option>
                <option value="session">In-person</option>
              </Select>
              <Button type="submit" variant="outline" size="sm">
                <Plus size={14} /> Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ))}

      <form action={createModule.bind(null, courseId)} className="flex items-center gap-2">
        <Input name="title" placeholder="New module title (e.g. Module 1 — Introduction)" />
        <Button type="submit">
          <Plus size={14} /> Add module
        </Button>
      </form>

      <LessonDrawer
        key={editing?.id ?? 'none'}
        courseId={courseId}
        lesson={editing}
        assessmentTypes={assessmentTypes}
        classes={classes}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function ModuleTitle({ courseId, mod }: { courseId: string; mod: ModuleLite }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <form
        action={async (fd) => {
          await updateModule(mod.id, courseId, fd)
          setEditing(false)
        }}
        className="flex flex-1 items-center gap-2"
      >
        <Input name="title" defaultValue={mod.title} className="h-9" autoFocus />
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex min-w-0 items-center gap-2 text-left"
    >
      <span className="truncate font-semibold text-slate-900">{mod.title}</span>
      <Pencil size={12} className="shrink-0 text-slate-300 group-hover:text-slate-500" />
    </button>
  )
}

function LessonDrawer({
  courseId,
  lesson,
  assessmentTypes,
  classes,
  onClose,
}: {
  courseId: string
  lesson: LessonLite | null
  assessmentTypes: { id: string; name: string }[]
  classes: { id: string; title: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [kind, setKind] = useState<LessonLite['kind']>(lesson?.kind ?? 'rich')
  const [rule, setRule] = useState<LessonLite['completionRule']>(lesson?.completionRule ?? 'view')
  const [required, setRequired] = useState(lesson?.isRequired ?? true)
  const [assessmentTypeId, setAssessmentTypeId] = useState(lesson?.assessmentTypeId ?? '')
  const [classId, setClassId] = useState(lesson?.classId ?? '')
  const [attachmentId, setAttachmentId] = useState(lesson?.attachmentId ?? '')
  const [embedUrl, setEmbedUrl] = useState(lesson?.embedUrl ?? '')
  const [duration, setDuration] = useState(lesson?.durationMinutes?.toString() ?? '')

  if (!lesson) return null

  function saveMeta() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('title', title)
      fd.set('kind', kind)
      fd.set('completionRule', rule)
      fd.set('isRequired', required ? 'on' : 'off')
      fd.set('assessmentTypeId', assessmentTypeId)
      fd.set('classId', classId)
      fd.set('attachmentId', attachmentId)
      fd.set('embedUrl', embedUrl)
      fd.set('durationMinutes', duration)
      await updateLesson(lesson!.id, courseId, fd)
      router.refresh()
      toast.success('Lesson saved')
    })
  }

  return (
    <Drawer
      open={!!lesson}
      onClose={onClose}
      title="Edit lesson"
      description="Configure the lesson, then build its content below."
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button type="button" onClick={saveMeta} disabled={pending}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save lesson
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lesson-title">Title</Label>
            <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={kind} onChange={(e) => setKind(e.currentTarget.value as LessonLite['kind'])}>
              <option value="rich">Lesson (rich content)</option>
              <option value="video">Video</option>
              <option value="file">File / handout</option>
              <option value="embed">Embedded page</option>
              <option value="quiz">Quiz</option>
              <option value="session">In-person session</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Completion</Label>
            <Select value={rule} onChange={(e) => setRule(e.currentTarget.value as LessonLite['completionRule'])}>
              <option value="view">Mark as viewed</option>
              <option value="acknowledge">Acknowledge (read &amp; understood)</option>
              <option value="pass">Pass the quiz</option>
              <option value="min_time">Spend minimum time</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.currentTarget.checked)} className="h-4 w-4 rounded border-slate-300" />
            Required for completion
          </label>
          <div className="space-y-1.5">
            <Label>Duration (min)</Label>
            <Input type="number" min="0" value={duration} onChange={(e) => setDuration(e.currentTarget.value)} placeholder="optional" />
          </div>
        </div>

        {kind === 'quiz' ? (
          <div className="space-y-1.5">
            <Label>Assessment (existing question set)</Label>
            <Select value={assessmentTypeId} onChange={(e) => setAssessmentTypeId(e.currentTarget.value)}>
              <option value="">— choose an assessment type —</option>
              {assessmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-slate-500">
              Reuses your native assessment engine. Manage question sets under Training → Assessment types.
            </p>
          </div>
        ) : null}

        {kind === 'session' ? (
          <div className="space-y-1.5">
            <Label>Scheduled class</Label>
            <Select value={classId} onChange={(e) => setClassId(e.currentTarget.value)}>
              <option value="">— choose a class —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {kind === 'embed' ? (
          <div className="space-y-1.5">
            <Label>Embed URL</Label>
            <Input value={embedUrl} onChange={(e) => setEmbedUrl(e.currentTarget.value)} placeholder="https://…" />
          </div>
        ) : null}

        {kind === 'video' ? (
          <div className="space-y-2">
            <Label>Video URL (YouTube / Vimeo / MP4)</Label>
            <Input value={embedUrl} onChange={(e) => setEmbedUrl(e.currentTarget.value)} placeholder="https://…" />
            <p className="text-center text-xs text-slate-400">— or upload —</p>
            <FileUploader
              requestUploadAction={requestUpload}
              finalizeUploadAction={finalizeUpload}
              kind="video"
              accept=".mp4,.mov,.webm"
              onUploaded={(f) => {
                setAttachmentId(f.attachmentId)
                setEmbedUrl('')
                toast.success('Video uploaded — Save lesson to keep it')
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
                toast.success('File uploaded — Save lesson to keep it')
              }}
              label="Drop a PDF / handout or click to choose"
            />
            {attachmentId ? <p className="text-xs text-emerald-700">File attached ✓</p> : null}
          </div>
        ) : null}

        {kind === 'rich' ? (
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <Label>Lesson content</Label>
            <BlockEditor
              initialBlocks={lesson.contentBlocks}
              onSave={async (blocks) => {
                await saveLessonContent(lesson!.id, courseId, blocks)
                router.refresh()
              }}
            />
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}
