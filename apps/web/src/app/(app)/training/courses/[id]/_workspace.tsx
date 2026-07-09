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
import { SmartBackLink } from '@/components/smart-back-link'
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
import { Badge, Button, FileUploader, Input, Label, RichTextEditor, Select } from '@beaconhs/ui'
import type { LessonBlock, PracticalCriterion, Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { LessonSurface } from './_lesson-surface'
import {
  CoursePresenter,
  type AssessmentMeta,
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
import { DELIVERY_OPTIONS, deliveryMeta } from '../../_lib/delivery'
import { startTrainingRecord } from '../../records/_actions'

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
  /** Set when the deck is mastered by an uploaded PowerPoint file. */
  sourceAttachmentId: string | null
  sourceFilename: string | null
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
  onlineUrl: string | null
  instructions: string | null
  durationMinutes: number | null
  validForMonths: number | null
  requiresEvaluator: boolean
  credentialOutputIds: string[]
}
export type CredentialOutputLite = { id: string; name: string; format: string }
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
  credentialOutputs,
  modules,
  assessmentTypes,
  classes,
  contentItems,
  itemContents,
  quizQuestions,
  assessmentMeta,
  attachmentMeta,
  attachmentUrls,
  records,
  recordsTotal,
  files,
}: {
  course: CourseLite
  credentialOutputs: CredentialOutputLite[]
  modules: ModuleLite[]
  assessmentTypes: { id: string; name: string }[]
  classes: ClassLite[]
  contentItems: { id: string; title: string; kind: string }[]
  itemContents: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
  attachmentMeta: Record<string, AttachmentMeta>
  attachmentUrls: Record<string, string | null | undefined>
  records: RecordLite[]
  recordsTotal: number
  files: FileLite[]
}) {
  const router = useRouter()
  const search = useSearchParams()
  // Delivery type lives in parent state so the whole workspace (tabs, build
  // surface, header, per-type surfaces) reshapes the instant the Overview
  // dropdown changes — before the settings are even saved. The Overview form
  // still posts this value on save.
  const [deliveryType, setDeliveryType] = useState(course.deliveryType)
  useEffect(() => setDeliveryType(course.deliveryType), [course.deliveryType])
  const delivery = deliveryMeta(deliveryType)
  // Fresh drafts (no code yet) land on Overview to capture name/code first;
  // established content courses land on the builder.
  const [railTab, setRailTab] = useState<RailTab>(
    delivery.hasContent && course.code ? 'build' : 'overview',
  )
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
  // Non-content delivery types (online, external certificate) get a settings
  // surface instead of the builder — but content authored before the type was
  // switched stays reachable so it can be reviewed or removed.
  const showBuilder = delivery.hasContent || tree.length > 0
  const activeTab: RailTab = railTab === 'build' && !showBuilder ? 'overview' : railTab

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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink
          href="/training/courses"
          label="Courses"
          className="shrink-0 text-sm text-teal-700 hover:underline dark:text-teal-300"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {course.name}
            </span>
            <Badge variant="secondary">{delivery.label}</Badge>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {course.code}
            {showBuilder
              ? ` · ${tree.length} module${tree.length === 1 ? '' : 's'} · ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`
              : ''}{' '}
            · {recordsTotal} record{recordsTotal === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showBuilder ? (
            <Link href={`/training/courses/${course.id}/evaluations`}>
              <Button variant="outline" size="sm">
                <UserCheck size={14} /> Evaluations
              </Button>
            </Link>
          ) : null}
          {delivery.selfLaunch || delivery.hasContent ? (
            <Link href={`/training/learn/${course.id}`}>
              <Button variant="outline" size="sm">
                <Eye size={14} /> Preview as learner
              </Button>
            </Link>
          ) : null}
          {showBuilder ? (
            <Button size="sm" onClick={() => setPresenting(true)} disabled={lessonCount === 0}>
              <Play size={14} /> Play
            </Button>
          ) : null}
        </div>
      </header>

      {presenting ? (
        <CoursePresenter
          courseName={course.name}
          modules={tree}
          items={itemContents}
          quizQuestions={quizQuestions}
          assessmentMeta={assessmentMeta}
          attachmentMeta={attachmentMeta}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      {/* ---- 1/3 | 2/3 ---- */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* left rail */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
            <RailTabBtn
              active={activeTab === 'overview'}
              onClick={() => setRailTab('overview')}
              icon={<Settings2 size={15} />}
              label="Overview"
            />
            {showBuilder ? (
              <RailTabBtn
                active={activeTab === 'build'}
                onClick={() => setRailTab('build')}
                icon={<Layers size={15} />}
                label="Build"
              />
            ) : null}
            <RailTabBtn
              active={activeTab === 'records'}
              onClick={() => setRailTab('records')}
              icon={<Award size={15} />}
              label="Records"
            />
            <RailTabBtn
              active={activeTab === 'classes'}
              onClick={() => setRailTab('classes')}
              icon={<CalendarDays size={15} />}
              label="Classes"
            />
            <RailTabBtn
              active={activeTab === 'files'}
              onClick={() => setRailTab('files')}
              icon={<FileText size={15} />}
              label="Files"
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'overview' ? (
              <OverviewPanel
                course={course}
                credentialOutputs={credentialOutputs}
                deliveryType={deliveryType}
                onDeliveryChange={setDeliveryType}
              />
            ) : null}
            {activeTab === 'build' ? (
              <BuildPalette onAdd={(kind) => addElement(kind, tree[tree.length - 1]?.id ?? null)} />
            ) : null}
            {activeTab === 'records' ? (
              <RecordsPanel course={course} records={records} total={recordsTotal} />
            ) : null}
            {activeTab === 'classes' ? <ClassesPanel classes={classes} /> : null}
            {activeTab === 'files' ? <FilesPanel courseId={course.id} files={files} /> : null}
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
        ) : !showBuilder ? (
          <DeliverySurface
            course={course}
            deliveryType={delivery.value}
            onOpenOverview={() => setRailTab('overview')}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                Course content
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
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
                {!delivery.hasContent ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    {delivery.label} courses have no in-app curriculum — learners never see these
                    lessons. Remove them, or change the delivery type in Overview.
                  </div>
                ) : null}
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
                        ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/30'
                        : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <div>
                      <Layers size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
                      <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                        Drag an element here
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Select a content type from the Build tab on the left — a module is created
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
        active
          ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200'
          : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
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
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
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
          className="flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/50 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-950 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
        >
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {el.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              {el.label}
            </span>
            <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              {el.desc}
            </span>
          </span>
        </button>
      ))}
      <p className="px-1 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
        Drag an element into a module on the right — or click to drop it into the last module.
      </p>
    </div>
  )
}

// Settings-driven delivery types (online, external certificate) get a focused
// surface in place of the curriculum builder.
function DeliverySurface({
  course,
  deliveryType,
  onOpenOverview,
}: {
  course: CourseLite
  deliveryType: string
  onOpenOverview: () => void
}) {
  const online = deliveryType === 'online'
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
          {online ? 'Online course' : 'External certification'}
        </span>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {online ? <Link2 size={18} /> : <Award size={18} />}
          </span>
          {online ? (
            <>
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Learners take this course at an external site
              </h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                The course appears in My training. Learners open the link, finish the course, and
                confirm completion — a training record and certificate are issued automatically.
              </p>
              {course.onlineUrl ? (
                <a
                  href={course.onlineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block max-w-full truncate rounded-md border border-slate-200 px-3 py-1.5 text-sm text-teal-700 hover:border-teal-300 dark:border-slate-700 dark:text-teal-300 dark:hover:border-teal-700"
                >
                  {course.onlineUrl}
                </a>
              ) : (
                <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  No course link set — learners have nothing to open.
                </p>
              )}
              <div className="mt-4">
                <Button type="button" variant="outline" size="sm" onClick={onOpenOverview}>
                  <Settings2 size={14} /> Edit link &amp; instructions
                </Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Certificates are recorded, not taken in the app
              </h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                This course tracks credentials earned outside BeaconHS. It never appears in the
                learner catalog — enter each person&apos;s certificate as a training record, or
                import them in bulk.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <form action={startTrainingRecord}>
                  <Button type="submit" size="sm">
                    <Plus size={14} /> Add record
                  </Button>
                </form>
                <Link href={`/training/records?q=${encodeURIComponent(course.code)}`}>
                  <Button type="button" variant="outline" size="sm">
                    <Award size={14} /> View records
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewPanel({
  course,
  credentialOutputs,
  deliveryType,
  onDeliveryChange,
}: {
  course: CourseLite
  credentialOutputs: CredentialOutputLite[]
  deliveryType: string
  onDeliveryChange: (value: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const delivery = deliveryType
  const formatLabel = (format: string) =>
    format === 'wallet' ? 'Wallet card' : format === 'letter-portrait' ? 'Portrait' : 'Full size'
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
        <Label htmlFor="ov-delivery">Delivery type</Label>
        <Select
          id="ov-delivery"
          name="deliveryType"
          value={delivery}
          onChange={(e) => onDeliveryChange(e.target.value)}
        >
          {DELIVERY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {deliveryMeta(delivery).hint}
        </p>
        <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Save settings to apply the delivery type.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-desc">Description</Label>
        <RichTextEditor
          name="description"
          defaultValue={course.description ?? ''}
          placeholder="What does this course cover?"
          minHeight="120px"
        />
      </div>
      {delivery === 'online' ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ov-url">Course URL</Label>
            <Input
              id="ov-url"
              name="onlineUrl"
              type="url"
              inputMode="url"
              placeholder="https://…"
              defaultValue={course.onlineUrl ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ov-instructions">Instructions</Label>
            <RichTextEditor
              name="instructions"
              defaultValue={course.instructions ?? ''}
              placeholder="How to access and complete the course…"
              minHeight="120px"
            />
          </div>
        </>
      ) : (
        // Keep the values persisted while the type is something other than
        // online, so switching back doesn't silently wipe them.
        <>
          <input type="hidden" name="onlineUrl" value={course.onlineUrl ?? ''} />
          <input type="hidden" name="instructions" value={course.instructions ?? ''} />
        </>
      )}
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
      {deliveryMeta(delivery).hasContent ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            name="requiresEvaluator"
            defaultChecked={course.requiresEvaluator}
            className="h-4 w-4 accent-teal-700"
          />
          Requires evaluator sign-off
        </label>
      ) : (
        <input
          type="hidden"
          name="requiresEvaluator"
          value={course.requiresEvaluator ? 'on' : ''}
        />
      )}
      <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <Label>Credential designs</Label>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Pick which Card Studio designs this course issues — choose any number (e.g. a wallet card
          and a full-size certificate). Leave all unchecked to use the tenant defaults.
        </p>
        {credentialOutputs.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-2.5 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No designs yet — create them in Card studio.
          </p>
        ) : (
          <div className="space-y-1">
            {credentialOutputs.map((output) => (
              <label
                key={output.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm dark:border-slate-800"
              >
                <input
                  type="checkbox"
                  name="credentialOutputIds"
                  value={output.id}
                  defaultChecked={course.credentialOutputIds.includes(output.id)}
                  className="h-4 w-4 accent-teal-700"
                />
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                  {output.name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                  {formatLabel(output.format)}
                </span>
              </label>
            ))}
          </div>
        )}
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
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
          Records ({total})
        </p>
        <Link
          href={`/training/records?q=${encodeURIComponent(course.code)}`}
          className="text-[11px] text-teal-700 hover:underline dark:text-teal-300"
        >
          View all →
        </Link>
      </div>
      {records.length === 0 ? (
        <p className="px-1 text-xs text-slate-400 dark:text-slate-500">No completions recorded.</p>
      ) : (
        records.map((r) => {
          const expired = r.expiresOn && r.expiresOn < today
          return (
            <Link
              key={r.id}
              href={`/training/records/${r.id}`}
              className="block rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-teal-300 dark:border-slate-800 dark:hover:border-teal-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                  {r.personName}
                </span>
                {expired ? <Badge variant="destructive">Expired</Badge> : null}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
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
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
          Scheduled classes
        </p>
        <Link
          href="/training/classes/new"
          className="text-[11px] text-teal-700 hover:underline dark:text-teal-300"
        >
          Schedule →
        </Link>
      </div>
      {classes.length === 0 ? (
        <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
          No classes scheduled for this course.
        </p>
      ) : (
        classes.map((c) => (
          <Link
            key={c.id}
            href={`/training/classes/${c.id}`}
            className="block rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-teal-300 dark:border-slate-800 dark:hover:border-teal-700"
          >
            <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
              {c.title}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
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
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
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
          className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-800"
        >
          <FileText size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
          {f.url ? (
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
            >
              {f.label ?? f.filename ?? 'File'}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
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
            className="text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400"
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
        className={`rounded-xl border bg-white shadow-sm transition-colors dark:bg-slate-900 ${
          dropHover
            ? 'border-teal-400 ring-2 ring-teal-200 dark:ring-teal-900/60'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          <button
            type="button"
            aria-label="Drag module"
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
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
                <span className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                  {mod.title}
                </span>
                <Pencil
                  size={11}
                  className="shrink-0 text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"
                />
              </button>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
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
                className="rounded p-1 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>

        <div className="space-y-1 p-2">
          {mod.lessons.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
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
      <div className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition-colors hover:border-teal-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-teal-700">
        <button
          type="button"
          aria-label="Drag lesson"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
        >
          <GripVertical size={13} />
        </button>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          {meta.icon}
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {lesson.title}
          </span>
          <span className="block text-[10px] text-slate-400 dark:text-slate-500">
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
