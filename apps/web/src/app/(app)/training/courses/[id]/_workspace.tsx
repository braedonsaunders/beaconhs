'use client'

// The course page IS the builder — one surface, the App-Builder convention:
//   left 1/3  : course rail — tabs for Overview / Build (element palette) /
//               Records / Classes / Files
//   right 2/3 : the build surface — modules ("chapters") with lessons; palette
//               elements drag-drop (or click) into modules to create lessons
//   editing   : clicking a lesson swaps the right 2/3 to the LessonSurface —
//               a documents-editor-style ribbon + inline WYSIWYG editor with a
//               fullscreen toggle (see _lesson-surface.tsx)

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Reorder, useDragControls } from 'framer-motion'
import {
  Award,
  CalendarDays,
  ClipboardCheck,
  Eye,
  FileText,
  GraduationCap,
  GripVertical,
  Layers,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Presentation,
  Settings2,
  Trash2,
  Type,
  UserCheck,
  Video,
} from 'lucide-react'
import { Badge, Button, FileUploader, Input, Label, Textarea } from '@beaconhs/ui'
import type { LessonBlock, PracticalCriterion, Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { LessonSurface } from './_lesson-surface'
import {
  CoursePresenter,
  type AttachmentMeta,
  type ItemContent,
  type QuizQuestion,
} from './_presenter'
import {
  addCourseFile,
  createLessonOfKind,
  createModule,
  deleteModule,
  removeCourseFile,
  reorderLessons,
  reorderModules,
  updateCourseSettings,
  updateModule,
} from './studio/_actions'

export type LessonKind =
  | 'rich'
  | 'video'
  | 'file'
  | 'embed'
  | 'quiz'
  | 'session'
  | 'slides'
  | 'practical'
export type CompletionRule = 'view' | 'pass' | 'acknowledge' | 'min_time' | 'evaluator'

export type LessonLite = {
  id: string
  moduleId: string
  title: string
  kind: LessonKind
  isRequired: boolean
  completionRule: CompletionRule
  assessmentTypeId: string | null
  classId: string | null
  attachmentId: string | null
  embedUrl: string | null
  contentItemId: string | null
  durationMinutes: number | null
  contentBlocks: LessonBlock[]
  contentJson: Record<string, unknown> | null
  contentHtml: string | null
  slides: Slide[]
  practicalCriteria: PracticalCriterion[]
  importStatus: string | null
  importError: string | null
}
export type ModuleLite = {
  id: string
  title: string
  description: string | null
  lessons: LessonLite[]
}
export type CourseLite = {
  id: string
  name: string
  code: string
  description: string | null
  deliveryType: string
  durationMinutes: number | null
  validForMonths: number | null
}
export type RecordLite = {
  id: string
  personName: string
  employeeNo: string | null
  completedOn: string | null
  expiresOn: string | null
}
export type ClassLite = { id: string; title: string; startsAt: string }
export type FileLite = {
  id: string
  label: string | null
  filename: string | null
  url: string | null
  sizeBytes: number | null
}

// --- Element palette ---------------------------------------------------------

const DRAG_MIME = 'text/lesson-kind'

const ELEMENTS: { kind: LessonKind; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    kind: 'rich',
    label: 'Text lesson',
    desc: 'Rich content blocks — text, images, callouts.',
    icon: <Type size={15} />,
  },
  {
    kind: 'slides',
    label: 'Slideshow',
    desc: 'Structured slides, or import a PowerPoint.',
    icon: <Presentation size={15} />,
  },
  {
    kind: 'video',
    label: 'Video',
    desc: 'Upload a video or link YouTube / Vimeo.',
    icon: <Video size={15} />,
  },
  {
    kind: 'quiz',
    label: 'Quiz',
    desc: 'Graded questions from an assessment set.',
    icon: <ClipboardCheck size={15} />,
  },
  {
    kind: 'practical',
    label: 'Practical test',
    desc: 'Hands-on test signed off by an evaluator.',
    icon: <UserCheck size={15} />,
  },
  {
    kind: 'session',
    label: 'In-person session',
    desc: 'Tie a scheduled class into the course.',
    icon: <GraduationCap size={15} />,
  },
  {
    kind: 'file',
    label: 'File / handout',
    desc: 'A downloadable PDF or document.',
    icon: <Paperclip size={15} />,
  },
  {
    kind: 'embed',
    label: 'Embedded page',
    desc: 'Embed an external web page.',
    icon: <Link2 size={15} />,
  },
]

const KIND_META: Record<LessonKind, { label: string; icon: React.ReactNode }> = {
  rich: { label: 'Text', icon: <Type size={13} /> },
  slides: { label: 'Slideshow', icon: <Presentation size={13} /> },
  video: { label: 'Video', icon: <Video size={13} /> },
  file: { label: 'File', icon: <Paperclip size={13} /> },
  embed: { label: 'Embed', icon: <Link2 size={13} /> },
  quiz: { label: 'Quiz', icon: <ClipboardCheck size={13} /> },
  session: { label: 'In-person', icon: <GraduationCap size={13} /> },
  practical: { label: 'Practical', icon: <UserCheck size={13} /> },
}

type RailTab = 'overview' | 'build' | 'records' | 'classes' | 'files'

export function CourseWorkspace({
  course,
  modules,
  assessmentTypes,
  classes,
  contentItems,
  itemContents,
  quizQuestions,
  attachmentMeta,
  attachmentUrls,
  records,
  recordsTotal,
  files,
}: {
  course: CourseLite
  modules: ModuleLite[]
  assessmentTypes: { id: string; name: string }[]
  classes: ClassLite[]
  contentItems: { id: string; title: string; kind: string }[]
  itemContents: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  attachmentMeta: Record<string, AttachmentMeta>
  attachmentUrls: Record<string, string | null | undefined>
  records: RecordLite[]
  recordsTotal: number
  files: FileLite[]
}) {
  const router = useRouter()
  const search = useSearchParams()
  const [railTab, setRailTab] = useState<RailTab>('build')
  const [tree, setTree] = useState<ModuleLite[]>(modules)
  const [editingId, setEditingId] = useState<string | null>(search.get('lesson'))
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [, startTransition] = useTransition()
  useEffect(() => setTree(modules), [modules])

  const moduleOrderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lessonOrderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allLessons = tree.flatMap((m) => m.lessons)
  const editing = allLessons.find((l) => l.id === editingId) ?? null
  const lessonCount = allLessons.length

  function openLesson(id: string) {
    setEditingId(id)
    router.replace(`/training/courses/${course.id}?lesson=${id}`, { scroll: false })
  }
  function closeLesson() {
    setEditingId(null)
    router.replace(`/training/courses/${course.id}`, { scroll: false })
  }

  function onReorderModules(next: ModuleLite[]) {
    setTree(next)
    if (moduleOrderTimer.current) clearTimeout(moduleOrderTimer.current)
    moduleOrderTimer.current = setTimeout(() => {
      void reorderModules(
        course.id,
        next.map((m) => m.id),
      )
    }, 600)
  }
  function onReorderLessons(moduleId: string, next: LessonLite[]) {
    setTree((prev) => prev.map((m) => (m.id === moduleId ? { ...m, lessons: next } : m)))
    if (lessonOrderTimer.current) clearTimeout(lessonOrderTimer.current)
    lessonOrderTimer.current = setTimeout(() => {
      void reorderLessons(
        course.id,
        next.map((l) => l.id),
      )
    }, 600)
  }

  /** Create a lesson of `kind` in `moduleId` (null → first/new module) and open it. */
  function addElement(kind: LessonKind, moduleId: string | null) {
    startTransition(async () => {
      try {
        const { id } = await createLessonOfKind(course.id, moduleId, kind)
        router.refresh()
        openLesson(id)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not add element')
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---- top header ---- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link href="/training/courses" className="shrink-0 text-sm text-teal-700 hover:underline">
          ← Courses
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{course.name}</span>
            <Badge variant="secondary">{course.deliveryType.replace('_', ' ')}</Badge>
          </div>
          <div className="text-xs text-slate-500">
            {course.code} · {tree.length} module{tree.length === 1 ? '' : 's'} · {lessonCount}{' '}
            lesson{lessonCount === 1 ? '' : 's'} · {recordsTotal} record
            {recordsTotal === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/training/courses/${course.id}/evaluations`}>
            <Button variant="outline" size="sm">
              <UserCheck size={14} /> Evaluations
            </Button>
          </Link>
          <Link href={`/training/learn/${course.id}`}>
            <Button variant="outline" size="sm">
              <Eye size={14} /> Preview as learner
            </Button>
          </Link>
          <Button size="sm" onClick={() => setPresenting(true)} disabled={lessonCount === 0}>
            <Play size={14} /> Play
          </Button>
        </div>
      </header>

      {presenting ? (
        <CoursePresenter
          courseName={course.name}
          modules={tree}
          items={itemContents}
          quizQuestions={quizQuestions}
          attachmentMeta={attachmentMeta}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      {/* ---- 1/3 | 2/3 ---- */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* left rail */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5">
            <RailTabBtn
              active={railTab === 'overview'}
              onClick={() => setRailTab('overview')}
              icon={<Settings2 size={15} />}
              label="Overview"
            />
            <RailTabBtn
              active={railTab === 'build'}
              onClick={() => setRailTab('build')}
              icon={<Layers size={15} />}
              label="Build"
            />
            <RailTabBtn
              active={railTab === 'records'}
              onClick={() => setRailTab('records')}
              icon={<Award size={15} />}
              label="Records"
            />
            <RailTabBtn
              active={railTab === 'classes'}
              onClick={() => setRailTab('classes')}
              icon={<CalendarDays size={15} />}
              label="Classes"
            />
            <RailTabBtn
              active={railTab === 'files'}
              onClick={() => setRailTab('files')}
              icon={<FileText size={15} />}
              label="Files"
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {railTab === 'overview' ? <OverviewPanel course={course} /> : null}
            {railTab === 'build' ? (
              <BuildPalette onAdd={(kind) => addElement(kind, tree[tree.length - 1]?.id ?? null)} />
            ) : null}
            {railTab === 'records' ? (
              <RecordsPanel course={course} records={records} total={recordsTotal} />
            ) : null}
            {railTab === 'classes' ? <ClassesPanel classes={classes} /> : null}
            {railTab === 'files' ? <FilesPanel courseId={course.id} files={files} /> : null}
          </div>
        </aside>

        {/* right: lesson editor surface (full 2/3) OR the build surface */}
        {editing ? (
          <div className="min-w-0 flex-1">
            <LessonSurface
              key={editing.id}
              courseId={course.id}
              lesson={editing}
              assessmentTypes={assessmentTypes}
              classes={classes}
              contentItems={contentItems}
              attachmentUrls={attachmentUrls}
              onClose={closeLesson}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5">
              <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Course content
              </span>
              <span className="text-xs text-slate-400">
                drag elements from the Build tab into a module
              </span>
              <div className="ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    startTransition(async () => {
                      const fd = new FormData()
                      fd.set('title', `Module ${tree.length + 1}`)
                      await createModule(course.id, fd)
                      router.refresh()
                    })
                  }
                >
                  <Plus size={13} /> Add module
                </Button>
              </div>
            </div>

            <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
              <div className="w-full space-y-4">
                {tree.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(DRAG_MIME)) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'copy'
                        setDropHover('__empty__')
                      }
                    }}
                    onDragLeave={() => setDropHover(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropHover(null)
                      const kind = e.dataTransfer.getData(DRAG_MIME) as LessonKind
                      if (kind) addElement(kind, null)
                    }}
                    className={`grid place-items-center rounded-xl border-2 border-dashed px-6 py-20 text-center transition-colors ${
                      dropHover === '__empty__'
                        ? 'border-teal-400 bg-teal-50'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    <div>
                      <Layers size={28} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-medium text-slate-600">
                        Drag your first element here
                      </p>
                      <p className="text-xs text-slate-400">
                        Pick a content type from the Build tab on the left — a module is created
                        automatically.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={tree}
                    onReorder={onReorderModules}
                    as="div"
                    className="space-y-4"
                  >
                    {tree.map((mod) => (
                      <ModuleCard
                        key={mod.id}
                        mod={mod}
                        courseId={course.id}
                        dropHover={dropHover === mod.id}
                        onDragState={(over) => setDropHover(over ? mod.id : null)}
                        onDropElement={(kind) => addElement(kind, mod.id)}
                        onReorderLessons={(next) => onReorderLessons(mod.id, next)}
                        onOpenLesson={openLesson}
                      />
                    ))}
                  </Reorder.Group>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RailTabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${
        active ? 'bg-teal-50 text-teal-800' : 'text-slate-500 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// --- Left rail panels --------------------------------------------------------

function BuildPalette({ onAdd }: { onAdd: (kind: LessonKind) => void }) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        Elements
      </p>
      {ELEMENTS.map((el) => (
        <button
          key={el.kind}
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, el.kind)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onAdd(el.kind)}
          title="Drag into a module — or click to add to the last module"
          className="flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/50 active:cursor-grabbing"
        >
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
            {el.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800">{el.label}</span>
            <span className="block text-[11px] leading-snug text-slate-500">{el.desc}</span>
          </span>
        </button>
      ))}
      <p className="px-1 pt-1 text-[11px] text-slate-400">
        Drag an element into a module on the right — or click to drop it into the last module.
      </p>
    </div>
  )
}

function OverviewPanel({ course }: { course: CourseLite }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await updateCourseSettings(course.id, fd)
          router.refresh()
          toast.success('Course saved')
        })
      }
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ov-name">Name</Label>
        <Input id="ov-name" name="name" defaultValue={course.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-code">Code</Label>
        <Input id="ov-code" name="code" defaultValue={course.code} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-desc">Description</Label>
        <Textarea
          id="ov-desc"
          name="description"
          rows={3}
          defaultValue={course.description ?? ''}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ov-dur">Duration (min)</Label>
          <Input
            id="ov-dur"
            name="durationMinutes"
            type="number"
            min="0"
            defaultValue={course.durationMinutes ?? ''}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ov-valid">Valid (months)</Label>
          <Input
            id="ov-valid"
            name="validForMonths"
            type="number"
            min="0"
            defaultValue={course.validForMonths ?? ''}
            placeholder="never"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
        Save settings
      </Button>
    </form>
  )
}

function RecordsPanel({
  course,
  records,
  total,
}: {
  course: CourseLite
  records: RecordLite[]
  total: number
}) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          Records ({total})
        </p>
        <Link
          href={`/training/records?q=${encodeURIComponent(course.code)}`}
          className="text-[11px] text-teal-700 hover:underline"
        >
          View all →
        </Link>
      </div>
      {records.length === 0 ? (
        <p className="px-1 text-xs text-slate-400">Nobody has completed this course yet.</p>
      ) : (
        records.map((r) => {
          const expired = r.expiresOn && r.expiresOn < today
          return (
            <Link
              key={r.id}
              href={`/training/records/${r.id}`}
              className="block rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-teal-300"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-800">{r.personName}</span>
                {expired ? <Badge variant="destructive">Expired</Badge> : null}
              </div>
              <div className="text-[10px] text-slate-500">
                {r.completedOn ?? '—'} → {r.expiresOn ?? 'no expiry'}
              </div>
            </Link>
          )
        })
      )}
    </div>
  )
}

function ClassesPanel({ classes }: { classes: ClassLite[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          Scheduled classes
        </p>
        <Link href="/training/classes/new" className="text-[11px] text-teal-700 hover:underline">
          Schedule →
        </Link>
      </div>
      {classes.length === 0 ? (
        <p className="px-1 text-xs text-slate-400">No classes scheduled for this course.</p>
      ) : (
        classes.map((c) => (
          <Link
            key={c.id}
            href={`/training/classes/${c.id}`}
            className="block rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-teal-300"
          >
            <div className="truncate text-xs font-medium text-slate-800">{c.title}</div>
            <div className="text-[10px] text-slate-500">
              {new Date(c.startsAt).toLocaleString()}
            </div>
          </Link>
        ))
      )}
    </div>
  )
}

function FilesPanel({ courseId, files }: { courseId: string; files: FileLite[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  return (
    <div className="space-y-2">
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        Course files
      </p>
      <FileUploader
        requestUploadAction={requestUpload}
        finalizeUploadAction={finalizeUpload}
        kind="document"
        accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md,.mp4,.mov,.webm,.png,.jpg,.jpeg"
        onUploaded={(f) =>
          startTransition(async () => {
            const res = await addCourseFile(courseId, f.attachmentId, f.filename)
            if (res.ok) {
              toast.success('File attached')
              router.refresh()
            } else toast.error(res.error ?? 'Failed')
          })
        }
        label="Drop a file or click to choose"
      />
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5"
        >
          <FileText size={13} className="shrink-0 text-slate-400" />
          {f.url ? (
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 hover:text-teal-700"
            >
              {f.label ?? f.filename ?? 'File'}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {f.label ?? f.filename ?? 'File'}
            </span>
          )}
          <button
            type="button"
            aria-label="Remove file"
            onClick={() =>
              startTransition(async () => {
                await removeCourseFile(courseId, f.id)
                router.refresh()
              })
            }
            className="text-slate-300 hover:text-rose-500"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

// --- Build surface -----------------------------------------------------------

function ModuleCard({
  mod,
  courseId,
  dropHover,
  onDragState,
  onDropElement,
  onReorderLessons,
  onOpenLesson,
}: {
  mod: ModuleLite
  courseId: string
  dropHover: boolean
  onDragState: (over: boolean) => void
  onDropElement: (kind: LessonKind) => void
  onReorderLessons: (next: LessonLite[]) => void
  onOpenLesson: (id: string) => void
}) {
  const router = useRouter()
  const controls = useDragControls()
  const [renaming, setRenaming] = useState(false)
  const [, startTransition] = useTransition()

  return (
    <Reorder.Item value={mod} dragListener={false} dragControls={controls} as="div">
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            onDragState(true)
          }
        }}
        onDragLeave={() => onDragState(false)}
        onDrop={(e) => {
          e.preventDefault()
          onDragState(false)
          const kind = e.dataTransfer.getData(DRAG_MIME) as LessonKind
          if (kind) onDropElement(kind)
        }}
        className={`rounded-xl border bg-white shadow-sm transition-colors ${
          dropHover ? 'border-teal-400 ring-2 ring-teal-200' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
          <button
            type="button"
            aria-label="Drag module"
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>
          {renaming ? (
            <form
              action={async (fd) => {
                await updateModule(mod.id, courseId, fd)
                setRenaming(false)
                router.refresh()
              }}
              className="flex flex-1 items-center gap-1.5"
            >
              <Input name="title" defaultValue={mod.title} className="h-8" autoFocus />
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="truncate text-sm font-bold text-slate-800">{mod.title}</span>
                <Pencil size={11} className="shrink-0 text-slate-300 group-hover:text-slate-500" />
              </button>
              <span className="text-[10px] text-slate-400">
                {mod.lessons.length} item{mod.lessons.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                aria-label="Delete module"
                onClick={() =>
                  startTransition(async () => {
                    if (!window.confirm('Delete this module and all its lessons?')) return
                    await deleteModule(mod.id, courseId)
                    router.refresh()
                  })
                }
                className="rounded p-1 text-slate-300 hover:text-rose-500"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>

        <div className="space-y-1 p-2">
          {mod.lessons.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
              Drop an element here
            </p>
          ) : (
            <Reorder.Group
              axis="y"
              values={mod.lessons}
              onReorder={onReorderLessons}
              as="div"
              className="space-y-1"
            >
              {mod.lessons.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  onOpen={() => onOpenLesson(lesson.id)}
                />
              ))}
            </Reorder.Group>
          )}
        </div>
      </div>
    </Reorder.Item>
  )
}

function LessonCard({ lesson, onOpen }: { lesson: LessonLite; onOpen: () => void }) {
  const controls = useDragControls()
  const meta = KIND_META[lesson.kind]
  const summary =
    lesson.kind === 'slides'
      ? `${lesson.slides.length} slide${lesson.slides.length === 1 ? '' : 's'}`
      : lesson.kind === 'practical'
        ? `${lesson.practicalCriteria.length} criteria`
        : lesson.durationMinutes
          ? `${lesson.durationMinutes} min`
          : null
  return (
    <Reorder.Item value={lesson} dragListener={false} dragControls={controls} as="div">
      <div className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition-colors hover:border-teal-300">
        <button
          type="button"
          aria-label="Drag lesson"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical size={13} />
        </button>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-slate-500">
          {meta.icon}
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-slate-800">{lesson.title}</span>
          <span className="block text-[10px] text-slate-400">
            {meta.label}
            {summary ? ` · ${summary}` : ''}
            {!lesson.isRequired ? ' · optional' : ''}
            {lesson.importStatus === 'pending' || lesson.importStatus === 'processing'
              ? ' · importing…'
              : ''}
          </span>
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen} aria-label="Edit lesson">
          <Pencil size={13} />
        </Button>
      </div>
    </Reorder.Item>
  )
}
