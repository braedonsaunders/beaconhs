'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The course page IS the builder — one surface, the App-Builder convention:
//   left 1/3  : course rail — tabs for Overview / Build (element palette) /
//               Records / Classes / Files
//   right 2/3 : the build surface — modules ("chapters") with lessons; palette
//               elements drag-drop (or click) into modules to create lessons
//   editing   : clicking a lesson swaps the right 2/3 to the LessonSurface —
//               a documents-editor-style ribbon + inline WYSIWYG editor with a
//               fullscreen toggle (see _lesson-surface.tsx)

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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
import type { PracticalCriterion } from '@beaconhs/db/schema'
import { normalizeDocumentHref } from '@beaconhs/forms-core'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { useReseededState } from '@/lib/use-reseeded-state'
import { LessonSurface, type LessonSaveController } from './_lesson-surface'
import { LatestAutosaveQueue, type AutosaveSnapshot } from './_lib/autosave-queue'
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
import { startClass } from '../../classes/_actions'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'

export type LessonKind =
  'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session' | 'slides' | 'practical'
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
  minTimeSeconds: number | null
  contentHtml: string | null
  practicalCriteria: PracticalCriterion[]
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
type CourseLite = {
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
type CredentialOutputLite = { id: string; name: string; format: string }
type RecordLite = {
  id: string
  personName: string
  employeeNo: string | null
  completedOn: string | null
  expiresOn: string | null
}
type ClassLite = { id: string; title: string; startsAt: string }
type FileLite = {
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
    desc: 'Import or create a PowerPoint presentation.',
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
  classOptions,
  classTotal,
  filteredClassTotal,
  classPage,
  classPerPage,
  contentItems,
  itemContents,
  quizQuestions,
  assessmentMeta,
  attachmentMeta,
  attachmentUrls,
  records,
  recordsTotal,
  filteredRecordsTotal,
  recordPage,
  recordPerPage,
  files,
  filesTotal,
  filteredFilesTotal,
  filePage,
  filePerPage,
  currentParams,
}: {
  course: CourseLite
  credentialOutputs: CredentialOutputLite[]
  modules: ModuleLite[]
  assessmentTypes: { id: string; name: string }[]
  classes: ClassLite[]
  classOptions: { id: string; title: string }[]
  classTotal: number
  filteredClassTotal: number
  classPage: number
  classPerPage: number
  contentItems: { id: string; title: string; kind: string }[]
  itemContents: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
  attachmentMeta: Record<string, AttachmentMeta>
  attachmentUrls: Record<string, string | null | undefined>
  records: RecordLite[]
  recordsTotal: number
  filteredRecordsTotal: number
  recordPage: number
  recordPerPage: number
  files: FileLite[]
  filesTotal: number
  filteredFilesTotal: number
  filePage: number
  filePerPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const search = useSearchParams()
  // Delivery type lives in parent state so the whole workspace (tabs, build
  // surface, header, per-type surfaces) reshapes the instant the Overview
  // dropdown changes — before the settings are even saved. The Overview form
  // still posts this value on save.
  const [deliveryType, setDeliveryType] = useReseededState(course.deliveryType, course.deliveryType)
  const delivery = deliveryMeta(deliveryType)
  // The course page opens on Overview (settings); authors switch to Build to
  // edit the curriculum.
  const [railTab, setRailTab] = useState<RailTab>('overview')
  const [tree, setTree] = useReseededState<ModuleLite[]>(modules, modules)
  const [editingId, setEditingId] = useState<string | null>(search.get('lesson'))
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [navigationBusy, setNavigationBusy] = useState(false)
  const [, startTransition] = useTransition()
  const [orderSaveQueue] = useState(() => new LatestAutosaveQueue())
  const [orderSaveSnapshot, setOrderSaveSnapshot] = useState<AutosaveSnapshot>({
    state: 'saved',
    error: null,
  })
  const lessonSaveController = useRef<LessonSaveController | null>(null)
  const navigationPending = useRef(false)

  useEffect(() => orderSaveQueue.subscribe(setOrderSaveSnapshot), [orderSaveQueue])

  const registerLessonSaveController = useCallback((controller: LessonSaveController | null) => {
    lessonSaveController.current = controller
  }, [])

  const hasPendingSaves = useCallback(
    () => orderSaveQueue.hasWork() || Boolean(lessonSaveController.current?.hasWork()),
    [orderSaveQueue],
  )

  const flushPendingSaves = useCallback(
    async (pause: boolean) => {
      const lessonController = lessonSaveController.current
      try {
        const results = await Promise.allSettled([
          pause ? orderSaveQueue.flushAndPause() : orderSaveQueue.flush(),
          lessonController
            ? pause
              ? lessonController.flushAndPause()
              : lessonController.flush()
            : Promise.resolve(),
        ])
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      } catch (error) {
        orderSaveQueue.resume()
        lessonController?.resume()
        throw error
      }
    },
    [orderSaveQueue],
  )

  useEffect(() => {
    const flushBestEffort = () => {
      if (!hasPendingSaves()) return
      void flushPendingSaves(false).catch(() => undefined)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingSaves()) return
      event.preventDefault()
      event.returnValue = ''
    }
    const visibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBestEffort()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', flushBestEffort)
    window.addEventListener('popstate', flushBestEffort)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('pagehide', flushBestEffort)
      window.removeEventListener('popstate', flushBestEffort)
      document.removeEventListener('visibilitychange', visibilityChange)
      flushBestEffort()
    }
  }, [flushPendingSaves, hasPendingSaves])

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
    const orderedIds = next.map((module) => module.id)
    orderSaveQueue.schedule('module-order', 600, () => reorderModules(course.id, orderedIds))
  }
  function onReorderLessons(moduleId: string, next: LessonLite[]) {
    setTree((prev) => prev.map((m) => (m.id === moduleId ? { ...m, lessons: next } : m)))
    const orderedIds = next.map((lesson) => lesson.id)
    orderSaveQueue.schedule(`lesson-order:${moduleId}`, 600, () =>
      reorderLessons(course.id, orderedIds),
    )
  }

  /** Create a lesson of `kind` in `moduleId` (null → first/new module) and open it. */
  function addElement(kind: LessonKind, moduleId: string | null) {
    startTransition(async () => {
      try {
        await orderSaveQueue.flush()
        const { id } = await createLessonOfKind(course.id, moduleId, kind)
        router.refresh()
        openLesson(id)
      } catch (e) {
        toast.error(
          tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_14ff953d726e6b')),
        )
      }
    })
  }

  const retryOrderSave = useCallback(async () => {
    try {
      await orderSaveQueue.retry()
    } catch (error) {
      toast.error(
        tGeneratedValue(error instanceof Error ? error.message : tGenerated('m_15912cf3ac6782')),
      )
    }
  }, [orderSaveQueue, tGenerated, tGeneratedValue])

  const openPresenter = useCallback(async () => {
    if (navigationPending.current) return
    navigationPending.current = true
    setNavigationBusy(true)
    try {
      await flushPendingSaves(true)
      setPresenting(true)
    } catch (error) {
      toast.error(
        tGeneratedValue(error instanceof Error ? error.message : tGenerated('m_12328d6d8f241a')),
      )
    } finally {
      navigationPending.current = false
      setNavigationBusy(false)
    }
  }, [flushPendingSaves, tGenerated, tGeneratedValue])

  const closePresenter = useCallback(() => {
    orderSaveQueue.resume()
    lessonSaveController.current?.resume()
    setPresenting(false)
  }, [orderSaveQueue])

  const handleNavigationCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !hasPendingSaves()) return
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return

      const opensElsewhere =
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      if (opensElsewhere) {
        void flushPendingSaves(false).catch((error: unknown) => {
          toast.error(
            tGeneratedValue(
              error instanceof Error ? error.message : tGenerated('m_12328d6d8f241a'),
            ),
          )
        })
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (navigationPending.current) return
      navigationPending.current = true
      setNavigationBusy(true)
      const destination = new URL(anchor.href, window.location.href)
      const current = new URL(window.location.href)
      void flushPendingSaves(true)
        .then(() => {
          if (destination.href === current.href) {
            orderSaveQueue.resume()
            lessonSaveController.current?.resume()
            setNavigationBusy(false)
            return
          }
          if (destination.origin === window.location.origin) {
            router.push(`${destination.pathname}${destination.search}${destination.hash}`)
          } else {
            window.location.assign(destination.href)
          }
        })
        .catch((error: unknown) => {
          setNavigationBusy(false)
          toast.error(
            tGeneratedValue(
              error instanceof Error ? error.message : tGenerated('m_12328d6d8f241a'),
            ),
          )
        })
        .finally(() => {
          navigationPending.current = false
        })
    },
    [flushPendingSaves, hasPendingSaves, orderSaveQueue, router, tGenerated, tGeneratedValue],
  )

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      aria-busy={navigationBusy}
      onClickCapture={handleNavigationCapture}
    >
      <GeneratedValue
        value={
          navigationBusy ? (
            <div className="absolute inset-0 z-[80] cursor-wait" role="status" aria-live="polite">
              <span className="sr-only">
                <GeneratedText id="m_031dfe2efc1d6a" />
              </span>
            </div>
          ) : null
        }
      />
      {/* ---- top header ---- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink
          href="/training/courses"
          label={tGenerated('m_0c5dd55a54140d')}
          className="shrink-0 text-sm text-teal-700 hover:underline dark:text-teal-300"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={course.name} />
            </span>
            <Badge variant="secondary">
              <GeneratedValue value={delivery.label} />
            </Badge>
            <OrderSaveBadge snapshot={orderSaveSnapshot} onRetry={() => void retryOrderSave()} />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={course.code} />
            <GeneratedValue
              value={
                showBuilder ? (
                  <GeneratedText
                    id="m_174b30574084c0"
                    values={{
                      value0: tree.length,
                      value1: tree.length === 1 ? '' : 's',
                      value2: lessonCount,
                      value3: lessonCount === 1 ? '' : 's',
                    }}
                  />
                ) : (
                  ''
                )
              }
            />
            <GeneratedValue value={' '} />
            · <GeneratedValue value={recordsTotal} /> <GeneratedText id="m_095c5766565794" />
            <GeneratedValue
              value={recordsTotal === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GeneratedValue
            value={
              delivery.value === 'online' ? (
                <Link href={`/training/courses/${course.id}/completions`}>
                  <Button variant="outline" size="sm">
                    <UserCheck size={14} /> <GeneratedText id="m_1469891f4de5bc" />
                  </Button>
                </Link>
              ) : null
            }
          />
          <GeneratedValue
            value={
              showBuilder ? (
                <Link href={`/training/courses/${course.id}/evaluations`}>
                  <Button variant="outline" size="sm">
                    <UserCheck size={14} /> <GeneratedText id="m_154a804ee4a673" />
                  </Button>
                </Link>
              ) : null
            }
          />
          <GeneratedValue
            value={
              delivery.selfLaunch || delivery.hasContent ? (
                <Link href={`/training/learn/${course.id}`}>
                  <Button variant="outline" size="sm">
                    <Eye size={14} /> <GeneratedText id="m_0ab951f99b80d5" />
                  </Button>
                </Link>
              ) : null
            }
          />
          <GeneratedValue
            value={
              showBuilder ? (
                <Button size="sm" onClick={() => void openPresenter()} disabled={lessonCount === 0}>
                  <Play size={14} /> <GeneratedText id="m_0db390678866e5" />
                </Button>
              ) : null
            }
          />
        </div>
      </header>

      <GeneratedValue
        value={
          presenting ? (
            <CoursePresenter
              courseId={course.id}
              courseName={course.name}
              modules={tree}
              items={itemContents}
              quizQuestions={quizQuestions}
              assessmentMeta={assessmentMeta}
              attachmentMeta={attachmentMeta}
              onClose={closePresenter}
            />
          ) : null
        }
      />

      {/* ---- 1/3 | 2/3 ---- */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* left rail */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
            <RailTabBtn
              active={activeTab === 'overview'}
              onClick={() => setRailTab('overview')}
              icon={<Settings2 size={15} />}
              label={tGenerated('m_102c6abe56e4d5')}
            />
            <GeneratedValue
              value={
                showBuilder ? (
                  <RailTabBtn
                    active={activeTab === 'build'}
                    onClick={() => setRailTab('build')}
                    icon={<Layers size={15} />}
                    label={tGenerated('m_0adae4a94c7be3')}
                  />
                ) : null
              }
            />
            <RailTabBtn
              active={activeTab === 'records'}
              onClick={() => setRailTab('records')}
              icon={<Award size={15} />}
              label={tGenerated('m_14fd485e580165')}
            />
            <RailTabBtn
              active={activeTab === 'classes'}
              onClick={() => setRailTab('classes')}
              icon={<CalendarDays size={15} />}
              label={tGenerated('m_0d872d8b08761a')}
            />
            <RailTabBtn
              active={activeTab === 'files'}
              onClick={() => setRailTab('files')}
              icon={<FileText size={15} />}
              label={tGenerated('m_17a2e308162add')}
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <GeneratedValue
              value={
                activeTab === 'overview' ? (
                  <OverviewPanel
                    course={course}
                    credentialOutputs={credentialOutputs}
                    deliveryType={deliveryType}
                    onDeliveryChange={setDeliveryType}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                activeTab === 'build' ? (
                  <BuildPalette
                    onAdd={(kind) => addElement(kind, tree[tree.length - 1]?.id ?? null)}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                activeTab === 'records' ? (
                  <RecordsPanel
                    course={course}
                    records={records}
                    total={recordsTotal}
                    filteredTotal={filteredRecordsTotal}
                    page={recordPage}
                    perPage={recordPerPage}
                    currentParams={currentParams}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                activeTab === 'classes' ? (
                  <ClassesPanel
                    courseId={course.id}
                    classes={classes}
                    total={classTotal}
                    filteredTotal={filteredClassTotal}
                    page={classPage}
                    perPage={classPerPage}
                    currentParams={currentParams}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                activeTab === 'files' ? (
                  <FilesPanel
                    courseId={course.id}
                    files={files}
                    total={filesTotal}
                    filteredTotal={filteredFilesTotal}
                    page={filePage}
                    perPage={filePerPage}
                    currentParams={currentParams}
                  />
                ) : null
              }
            />
          </div>
        </aside>

        {/* right: lesson editor surface (full 2/3) OR the build surface */}
        <GeneratedValue
          value={
            editing ? (
              <div className="min-w-0 flex-1">
                <LessonSurface
                  key={editing.id}
                  courseId={course.id}
                  lesson={editing}
                  assessmentTypes={assessmentTypes}
                  classes={classOptions}
                  contentItems={contentItems}
                  attachmentUrls={attachmentUrls}
                  onClose={closeLesson}
                  onSaveControllerChange={registerLessonSaveController}
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
                    <GeneratedText id="m_1059e76b02489d" />
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    <GeneratedText id="m_0aacefe9bcfe52" />
                  </span>
                  <div className="ml-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          try {
                            const fd = new FormData()
                            fd.set('title', `Module ${tree.length + 1}`)
                            await orderSaveQueue.flush()
                            await createModule(course.id, fd)
                            router.refresh()
                          } catch (error) {
                            toast.error(
                              tGeneratedValue(
                                error instanceof Error
                                  ? error.message
                                  : tGenerated('m_0cff55d87ce7de'),
                              ),
                            )
                          }
                        })
                      }
                    >
                      <Plus size={13} /> <GeneratedText id="m_03a8e15c4ad295" />
                    </Button>
                  </div>
                </div>

                <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
                  <div className="w-full space-y-4">
                    <GeneratedValue
                      value={
                        !delivery.hasContent ? (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                            <GeneratedValue value={delivery.label} />{' '}
                            <GeneratedText id="m_1251fa48c80173" />
                          </div>
                        ) : null
                      }
                    />
                    <GeneratedValue
                      value={
                        tree.length === 0 ? (
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
                              <Layers
                                size={28}
                                className="mx-auto text-slate-300 dark:text-slate-600"
                              />
                              <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                                <GeneratedText id="m_089ba37d6c34f4" />
                              </p>
                              <p className="text-xs text-slate-400 dark:text-slate-500">
                                <GeneratedText id="m_01607c309dbcdf" />
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
                            <GeneratedValue
                              value={tree.map((mod) => (
                                <ModuleCard
                                  key={mod.id}
                                  mod={mod}
                                  courseId={course.id}
                                  dropHover={dropHover === mod.id}
                                  onDragState={(over) => setDropHover(over ? mod.id : null)}
                                  onDropElement={(kind) => addElement(kind, mod.id)}
                                  onReorderLessons={(next) => onReorderLessons(mod.id, next)}
                                  onOpenLesson={openLesson}
                                  beforeStructureMutation={() => orderSaveQueue.flush()}
                                />
                              ))}
                            />
                          </Reorder.Group>
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            )
          }
        />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      onClick={onClick}
      title={tGeneratedValue(label)}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${
        active
          ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200'
          : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
      }`}
    >
      <GeneratedValue value={icon} />
      <GeneratedValue value={label} />
    </button>
  )
}

// --- Left rail panels --------------------------------------------------------

function BuildPalette({ onAdd }: { onAdd: (kind: LessonKind) => void }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-2">
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedText id="m_094a7426a3a90a" />
      </p>
      <GeneratedValue
        value={ELEMENTS.map((el) => (
          <button
            key={el.kind}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, el.kind)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAdd(el.kind)}
            title={tGenerated('m_14beedced86c4c')}
            className="flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/50 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-950 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <GeneratedValue value={el.icon} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                <GeneratedValue value={el.label} />
              </span>
              <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                <GeneratedValue value={el.desc} />
              </span>
            </span>
          </button>
        ))}
      />
      <p className="px-1 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_1094697b83407a" />
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
          <GeneratedValue
            value={
              online ? (
                <GeneratedText id="m_0f869eebe5364a" />
              ) : (
                <GeneratedText id="m_13d28e24802c60" />
              )
            }
          />
        </span>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <GeneratedValue value={online ? <Link2 size={18} /> : <Award size={18} />} />
          </span>
          <GeneratedValue
            value={
              online ? (
                <>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_08d8e0ae1e38a7" />
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_0a52571258788e" />
                  </p>
                  <GeneratedValue
                    value={
                      course.onlineUrl ? (
                        <a
                          href={course.onlineUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 inline-block max-w-full truncate rounded-md border border-slate-200 px-3 py-1.5 text-sm text-teal-700 hover:border-teal-300 dark:border-slate-700 dark:text-teal-300 dark:hover:border-teal-700"
                        >
                          <GeneratedValue value={course.onlineUrl} />
                        </a>
                      ) : (
                        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                          <GeneratedText id="m_1d6a099d14ef32" />
                        </p>
                      )
                    }
                  />
                  <div className="mt-4">
                    <Button type="button" variant="outline" size="sm" onClick={onOpenOverview}>
                      <Settings2 size={14} /> <GeneratedText id="m_06abc7b6a05561" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_0aa8d29b94e775" />
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_0f3b4bc001e9e7" />
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <form action={startTrainingRecord}>
                      <Button type="submit" size="sm">
                        <Plus size={14} /> <GeneratedText id="m_07b755f7fda9a5" />
                      </Button>
                    </form>
                    <Link href={`/training/records?q=${encodeURIComponent(course.code)}`}>
                      <Button type="button" variant="outline" size="sm">
                        <Award size={14} /> <GeneratedText id="m_0afb6dda5fea41" />
                      </Button>
                    </Link>
                  </div>
                </>
              )
            }
          />
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
  const tGenerated = useGeneratedTranslations()
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
          toast.success(tGenerated('m_02f44c0115ab7f'))
        })
      }
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ov-name">
          <GeneratedText id="m_02b18d5c7f6f2d" />
        </Label>
        <Input id="ov-name" name="name" defaultValue={course.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-code">
          <GeneratedText id="m_0570e24c85cf95" />
        </Label>
        <Input id="ov-code" name="code" defaultValue={course.code} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-delivery">
          <GeneratedText id="m_0c93e127b22028" />
        </Label>
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
          <GeneratedValue value={deliveryMeta(delivery).hint} />
        </p>
        <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          <GeneratedText id="m_0dd4f851157c99" />
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ov-desc">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <RichTextEditor
          name="description"
          defaultValue={course.description ?? ''}
          placeholder={tGenerated('m_1b4832ae7141ed')}
          minHeight="120px"
          normalizeLink={normalizeDocumentHref}
          onInvalidLink={() => toast.error(tGenerated('m_19dc719a9038ec'))}
        />
      </div>
      <GeneratedValue
        value={
          delivery === 'online' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ov-url">
                  <GeneratedText id="m_129c0875d29ca8" />
                </Label>
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
                <Label htmlFor="ov-instructions">
                  <GeneratedText id="m_146cd84bfd9be5" />
                </Label>
                <RichTextEditor
                  name="instructions"
                  defaultValue={course.instructions ?? ''}
                  placeholder={tGenerated('m_1b3ffa33e174e6')}
                  minHeight="120px"
                  normalizeLink={normalizeDocumentHref}
                  onInvalidLink={() => toast.error(tGenerated('m_19dc719a9038ec'))}
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
          )
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ov-dur">
            <GeneratedText id="m_1cdd3166803ea3" />
          </Label>
          <Input
            id="ov-dur"
            name="durationMinutes"
            type="number"
            min="0"
            defaultValue={course.durationMinutes ?? ''}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ov-valid">
            <GeneratedText id="m_1d125c9a388bab" />
          </Label>
          <Input
            id="ov-valid"
            name="validForMonths"
            type="number"
            min="0"
            defaultValue={course.validForMonths ?? ''}
            placeholder={tGenerated('m_069a3d1a5f8ba4')}
          />
        </div>
      </div>
      <GeneratedValue
        value={
          deliveryMeta(delivery).hasContent ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                name="requiresEvaluator"
                defaultChecked={course.requiresEvaluator}
                className="h-4 w-4 accent-teal-700"
              />
              <GeneratedText id="m_11e47750a9d8cd" />
            </label>
          ) : (
            <input
              type="hidden"
              name="requiresEvaluator"
              value={course.requiresEvaluator ? 'on' : ''}
            />
          )
        }
      />
      <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <Label>
          <GeneratedText id="m_0977ac20588e33" />
        </Label>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_1585b00744ee31" />
        </p>
        <GeneratedValue
          value={
            credentialOutputs.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-2.5 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <GeneratedText id="m_1428fc12379a7b" />
              </p>
            ) : (
              <div className="space-y-1">
                <GeneratedValue
                  value={credentialOutputs.map((output) => (
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
                        <GeneratedValue value={output.name} />
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                        <GeneratedValue value={formatLabel(output.format)} />
                      </span>
                    </label>
                  ))}
                />
              </div>
            )
          }
        />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        <GeneratedValue
          value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
        />
        <GeneratedText id="m_0bdcc953ae29cd" />
      </Button>
    </form>
  )
}

function RecordsPanel({
  course,
  records,
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
}: {
  course: CourseLite
  records: RecordLite[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGenerated = useGeneratedTranslations()
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
          <GeneratedText id="m_1698f11820f072" />
          <GeneratedValue value={total} />)
        </p>
        <Link
          href={`/training/records?q=${encodeURIComponent(course.code)}`}
          className="text-[11px] text-teal-700 hover:underline dark:text-teal-300"
        >
          <GeneratedText id="m_000536fca3e949" />
        </Link>
      </div>
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_0b842b664b4f3b')}
          paramKey="recordQ"
          pageParamKey="recordPage"
        />
        <FilterChips
          basePath={`/training/courses/${course.id}`}
          currentParams={currentParams}
          paramKey="recordStatus"
          pageParamKey="recordPage"
          label={tGenerated('m_0b9da892d6faf0')}
          options={[
            { value: 'current', label: 'Current' },
            { value: 'expired', label: 'Expired' },
            { value: 'no_expiry', label: 'No expiry' },
          ]}
        />
        <FilterChips
          basePath={`/training/courses/${course.id}`}
          currentParams={currentParams}
          paramKey="recordSort"
          pageParamKey="recordPage"
          label={tGenerated('m_126e942baf656b')}
          defaultValue="recent"
          hideAll
          options={[
            { value: 'recent', label: 'Recent completion' },
            { value: 'name', label: 'Person name' },
            { value: 'expiry', label: 'Expiry' },
          ]}
        />
      </TableToolbar>
      <GeneratedValue
        value={
          records.length === 0 ? (
            <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue
                value={
                  total === 0 ? (
                    <GeneratedText id="m_107a8fc7e1d681" />
                  ) : (
                    <GeneratedText id="m_00b20f4c53d716" />
                  )
                }
              />
            </p>
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
                      <GeneratedValue value={r.personName} />
                    </span>
                    <GeneratedValue
                      value={
                        expired ? (
                          <Badge variant="destructive">
                            <GeneratedText id="m_13f7150c94b182" />
                          </Badge>
                        ) : null
                      }
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={r.completedOn ?? '—'} /> →{' '}
                    <GeneratedValue
                      value={r.expiresOn ?? <GeneratedText id="m_020c1d7591eb5b" />}
                    />
                  </div>
                </Link>
              )
            })
          )
        }
      />
      <Pagination
        basePath={`/training/courses/${course.id}`}
        currentParams={currentParams}
        total={filteredTotal}
        page={page}
        perPage={perPage}
        pageParamKey="recordPage"
      />
    </div>
  )
}

function ClassesPanel({
  courseId,
  classes,
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
}: {
  courseId: string
  classes: ClassLite[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
          <GeneratedText id="m_0a5d49c79faf89" />
          <GeneratedValue value={total} />)
        </p>
        <form action={startClass}>
          <button
            type="submit"
            className="text-[11px] text-teal-700 hover:underline dark:text-teal-300"
          >
            <GeneratedText id="m_0660cbadee00bc" />
          </button>
        </form>
      </div>
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_1aaf5738ca7049')}
          paramKey="classQ"
          pageParamKey="classPage"
        />
        <FilterChips
          basePath={`/training/courses/${courseId}`}
          currentParams={currentParams}
          paramKey="classStatus"
          pageParamKey="classPage"
          label={tGenerated('m_0b9da892d6faf0')}
          options={[
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <FilterChips
          basePath={`/training/courses/${courseId}`}
          currentParams={currentParams}
          paramKey="classSort"
          pageParamKey="classPage"
          label={tGenerated('m_126e942baf656b')}
          defaultValue="upcoming"
          hideAll
          options={[
            { value: 'upcoming', label: 'Earliest first' },
            { value: 'recent', label: 'Latest first' },
          ]}
        />
      </TableToolbar>
      <GeneratedValue
        value={
          classes.length === 0 ? (
            <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue
                value={
                  total === 0 ? (
                    <GeneratedText id="m_0d7a8e20e25753" />
                  ) : (
                    <GeneratedText id="m_175a21f131383a" />
                  )
                }
              />
            </p>
          ) : (
            classes.map((c) => (
              <Link
                key={c.id}
                href={`/training/classes/${c.id}`}
                className="block rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-teal-300 dark:border-slate-800 dark:hover:border-teal-700"
              >
                <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                  <GeneratedValue value={c.title} />
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={new Date(c.startsAt).toLocaleString()} />
                </div>
              </Link>
            ))
          )
        }
      />
      <Pagination
        basePath={`/training/courses/${courseId}`}
        currentParams={currentParams}
        total={filteredTotal}
        page={page}
        perPage={perPage}
        pageParamKey="classPage"
      />
    </div>
  )
}

function FilesPanel({
  courseId,
  files,
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
}: {
  courseId: string
  files: FileLite[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [, startTransition] = useTransition()
  return (
    <div className="space-y-2">
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedText id="m_05abf04c7c6237" />
        <GeneratedValue value={total} />)
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
              toast.success(tGenerated('m_019ab826f0c999'))
              router.refresh()
            } else toast.error(tGeneratedValue(res.error ?? tGenerated('m_031021f2893bc9')))
          })
        }
        label={tGenerated('m_19a3ac982892ab')}
      />
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_19cd86c7049a68')}
          paramKey="fileQ"
          pageParamKey="filePage"
        />
        <FilterChips
          basePath={`/training/courses/${courseId}`}
          currentParams={currentParams}
          paramKey="fileType"
          pageParamKey="filePage"
          label={tGenerated('m_074ba2f160c506')}
          options={[
            { value: 'document', label: 'Documents' },
            { value: 'image', label: 'Images' },
            { value: 'video', label: 'Video' },
          ]}
        />
        <FilterChips
          basePath={`/training/courses/${courseId}`}
          currentParams={currentParams}
          paramKey="fileSort"
          pageParamKey="filePage"
          label={tGenerated('m_126e942baf656b')}
          defaultValue="name"
          hideAll
          options={[
            { value: 'name', label: 'File name' },
            { value: 'recent', label: 'Newest first' },
          ]}
        />
      </TableToolbar>
      <GeneratedValue
        value={
          files.length === 0 ? (
            <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue
                value={
                  total === 0 ? (
                    <GeneratedText id="m_16ab15b58c8a25" />
                  ) : (
                    <GeneratedText id="m_162b70fba7777c" />
                  )
                }
              />
            </p>
          ) : null
        }
      />
      <GeneratedValue
        value={files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-800"
          >
            <FileText size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
            <GeneratedValue
              value={
                f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
                  >
                    <GeneratedValue
                      value={f.label ?? f.filename ?? <GeneratedText id="m_102a42d098d1d2" />}
                    />
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue
                      value={f.label ?? f.filename ?? <GeneratedText id="m_102a42d098d1d2" />}
                    />
                  </span>
                )
              }
            />
            <button
              type="button"
              aria-label={tGenerated('m_02038865a602d6')}
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
      />
      <Pagination
        basePath={`/training/courses/${courseId}`}
        currentParams={currentParams}
        total={filteredTotal}
        page={page}
        perPage={perPage}
        pageParamKey="filePage"
      />
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
  beforeStructureMutation,
}: {
  mod: ModuleLite
  courseId: string
  dropHover: boolean
  onDragState: (over: boolean) => void
  onDropElement: (kind: LessonKind) => void
  onReorderLessons: (next: LessonLite[]) => void
  onOpenLesson: (id: string) => void
  beforeStructureMutation: () => Promise<void>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
            aria-label={tGenerated('m_0941b3d672779a')}
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
          >
            <GripVertical size={14} />
          </button>
          <GeneratedValue
            value={
              renaming ? (
                <form
                  action={async (fd) => {
                    try {
                      await beforeStructureMutation()
                      await updateModule(mod.id, courseId, fd)
                      setRenaming(false)
                      router.refresh()
                    } catch (error) {
                      toast.error(
                        tGeneratedValue(
                          error instanceof Error ? error.message : tGenerated('m_0c5ee804abb9df'),
                        ),
                      )
                    }
                  }}
                  className="flex flex-1 items-center gap-1.5"
                >
                  <Input name="title" defaultValue={mod.title} className="h-8" autoFocus />
                  <Button type="submit" size="sm">
                    <GeneratedText id="m_19e6bff894c3c7" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRenaming(false)}
                  >
                    <GeneratedText id="m_112e2e8ecda428" />
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
                      <GeneratedValue value={mod.title} />
                    </span>
                    <Pencil
                      size={11}
                      className="shrink-0 text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"
                    />
                  </button>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    <GeneratedValue value={mod.lessons.length} />{' '}
                    <GeneratedText id="m_089f2b1abdb347" />
                    <GeneratedValue
                      value={
                        mod.lessons.length === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />
                      }
                    />
                  </span>
                  <button
                    type="button"
                    aria-label={tGenerated('m_006a257f5b3bfa')}
                    onClick={async () => {
                      if (
                        !(await confirmDialog({
                          message: 'Delete this module and all its lessons?',
                          tone: 'danger',
                        }))
                      )
                        return
                      startTransition(async () => {
                        try {
                          await beforeStructureMutation()
                          await deleteModule(mod.id, courseId)
                          router.refresh()
                        } catch (error) {
                          toast.error(
                            tGeneratedValue(
                              error instanceof Error
                                ? error.message
                                : tGenerated('m_1930e1037a7272'),
                            ),
                          )
                        }
                      })
                    }}
                    className="rounded p-1 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )
            }
          />
        </div>

        <div className="space-y-1 p-2">
          <GeneratedValue
            value={
              mod.lessons.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  <GeneratedText id="m_1d2444f5ab7f1d" />
                </p>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={mod.lessons}
                  onReorder={onReorderLessons}
                  as="div"
                  className="space-y-1"
                >
                  <GeneratedValue
                    value={mod.lessons.map((lesson) => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        onOpen={() => onOpenLesson(lesson.id)}
                      />
                    ))}
                  />
                </Reorder.Group>
              )
            }
          />
        </div>
      </div>
    </Reorder.Item>
  )
}

function LessonCard({ lesson, onOpen }: { lesson: LessonLite; onOpen: () => void }) {
  const tGenerated = useGeneratedTranslations()
  const controls = useDragControls()
  const meta = KIND_META[lesson.kind]
  const summary =
    lesson.kind === 'slides'
      ? (lesson.sourceFilename ?? 'PowerPoint presentation')
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
          aria-label={tGenerated('m_04285e1248563c')}
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
        >
          <GripVertical size={13} />
        </button>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <GeneratedValue value={meta.icon} />
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            <GeneratedValue value={lesson.title} />
          </span>
          <span className="block text-[10px] text-slate-400 dark:text-slate-500">
            <GeneratedValue value={meta.label} />
            <GeneratedValue value={summary ? ` · ${summary}` : ''} />
            <GeneratedValue
              value={!lesson.isRequired ? <GeneratedText id="m_1738060036f0ca" /> : ''}
            />
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpen}
          aria-label={tGenerated('m_1b0c8a61e96317')}
        >
          <Pencil size={13} />
        </Button>
      </div>
    </Reorder.Item>
  )
}

function OrderSaveBadge({
  snapshot,
  onRetry,
}: {
  snapshot: AutosaveSnapshot
  onRetry: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  if (snapshot.state === 'saved') return null
  if (snapshot.state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={tGeneratedValue(snapshot.error ?? tGenerated('m_15912cf3ac6782'))}
        className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-300"
      >
        <GeneratedText id="m_06f20b13aeae69" />
      </button>
    )
  }
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500"
    >
      <GeneratedValue
        value={snapshot.state === 'saving' ? <Loader2 size={11} className="animate-spin" /> : null}
      />
      <GeneratedValue
        value={
          snapshot.state === 'saving' ? (
            <GeneratedText id="m_009d96caa82052" />
          ) : (
            <GeneratedText id="m_0946efb91ee8da" />
          )
        }
      />
    </span>
  )
}
