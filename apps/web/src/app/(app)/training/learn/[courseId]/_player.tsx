'use client'

// Learner course player — curriculum sidebar + lesson viewer. Rich content is
// sanitized HTML; quiz lessons hand off to the native assessment engine;
// completing the last required lesson issues the certificate.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Award,
  Check,
  ClipboardCheck,
  Clock,
  ExternalLink,
  GraduationCap,
  Loader2,
  PlayCircle,
  Presentation,
  UserCheck,
} from 'lucide-react'
import { Badge, Button, Card, CardContent } from '@beaconhs/ui'
import type { LessonBlock, PracticalCriterion, Slide } from '@beaconhs/db/schema'
import { LessonBlocksView } from '../../_lib/blocks'
import { SlidePlayer } from '../../_components/slide-player'
import {
  completeOnlineCourse,
  enrollInCourse,
  markLessonComplete,
  startLessonQuiz,
} from '../_actions'
import { toast } from '@/lib/toast'

type PlayerEvaluation = {
  evaluatorName: string | null
  notes: string | null
  signatureDataUrl: string | null
  criteriaResults: Record<string, boolean> | null
  completedAt: string | null
}

type PlayerLesson = {
  id: string
  title: string
  kind: 'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session' | 'slides' | 'practical'
  completionRule: 'view' | 'pass' | 'acknowledge' | 'min_time' | 'evaluator'
  isRequired: boolean
  contentHtml: string | null
  slides: Slide[]
  practicalCriteria: PracticalCriterion[]
  evaluation: PlayerEvaluation | null
  embedUrl: string | null
  attachmentId: string | null
  assessmentTypeId: string | null
  classTitle: string | null
  durationMinutes: number | null
  status: 'not_started' | 'in_progress' | 'completed'
}
export type PlayerModule = { id: string; title: string; lessons: PlayerLesson[] }

function asBlocks(l: PlayerLesson): LessonBlock[] {
  switch (l.kind) {
    case 'video':
      return [
        {
          id: l.id,
          type: 'video',
          url: l.embedUrl ?? undefined,
          attachmentId: l.attachmentId ?? undefined,
        },
      ]
    case 'file':
      return [{ id: l.id, type: 'file', attachmentId: l.attachmentId ?? '', label: l.title }]
    case 'embed':
      return [{ id: l.id, type: 'embed', url: l.embedUrl ?? '' }]
    default:
      return []
  }
}

export function CoursePlayer({
  modules,
  enrollmentId,
  attachmentUrls,
  completed,
  certificateRecordId,
  issuesRecord,
}: {
  modules: PlayerModule[]
  enrollmentId: string
  attachmentUrls: Record<string, string | null | undefined>
  completed: boolean
  certificateRecordId: string | null
  /** Whether finishing here issues the record, or the instructor issues it later. */
  issuesRecord: boolean
}) {
  const router = useRouter()
  const all = modules.flatMap((m) => m.lessons)
  const firstIncomplete = all.find((l) => l.status !== 'completed') ?? all[0] ?? null
  const [currentId, setCurrentId] = useState<string | null>(firstIncomplete?.id ?? null)
  const [pending, startTransition] = useTransition()
  // Slideshow lessons unlock their Mark-complete button on reaching the end.
  const [finishedSlides, setFinishedSlides] = useState<Set<string>>(new Set())

  const current = all.find((l) => l.id === currentId) ?? null
  const completedCount = all.filter((l) => l.status === 'completed').length
  const percent = all.length ? Math.round((completedCount / all.length) * 100) : 0

  function complete(lessonId: string) {
    startTransition(async () => {
      try {
        await markLessonComplete(enrollmentId, lessonId)
        const idx = all.findIndex((l) => l.id === lessonId)
        const next = all[idx + 1]
        if (next) setCurrentId(next.id)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not complete lesson')
      }
    })
  }
  function startQuiz(lessonId: string) {
    startTransition(async () => {
      try {
        await startLessonQuiz(enrollmentId, lessonId)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not start quiz')
      }
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Progress</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {completedCount} of {all.length} lessons complete
          </p>
        </div>

        <nav className="space-y-3">
          {modules.map((m) => (
            <div key={m.id}>
              <p className="px-1 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                {m.title}
              </p>
              <ul className="space-y-0.5">
                {m.lessons.map((l) => {
                  const active = l.id === currentId
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setCurrentId(l.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                          active
                            ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'
                        }`}
                      >
                        <span className="shrink-0">
                          {l.status === 'completed' ? (
                            <Check size={15} className="text-emerald-600" />
                          ) : l.kind === 'quiz' ? (
                            <ClipboardCheck
                              size={15}
                              className="text-slate-400 dark:text-slate-500"
                            />
                          ) : l.kind === 'slides' ? (
                            <Presentation
                              size={15}
                              className="text-slate-400 dark:text-slate-500"
                            />
                          ) : l.kind === 'practical' ? (
                            <UserCheck size={15} className="text-slate-400 dark:text-slate-500" />
                          ) : (
                            <PlayCircle size={15} className="text-slate-300 dark:text-slate-600" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        {!l.isRequired ? (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            opt
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 space-y-4">
        {completed ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <Award size={24} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Course complete 🎉
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {issuesRecord
                    ? `Your training record has been logged${certificateRecordId ? ' and a certificate issued' : ''}.`
                    : 'You have finished the course content. Your instructor issues your training record when the class is completed.'}
                </p>
              </div>
              {certificateRecordId ? (
                <Link href={`/training/records/${certificateRecordId}/certificate`}>
                  <Button>
                    <Award size={14} /> Download certificate
                  </Button>
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!current ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              This course has no lessons.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-5 py-6">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {current.title}
                  </h1>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Badge variant="secondary">{current.kind}</Badge>
                    {current.durationMinutes ? (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {current.durationMinutes} min
                      </span>
                    ) : null}
                    {current.status === 'completed' ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <Check size={12} /> Completed
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {current.kind === 'slides' ? (
                <SlidePlayer
                  slides={current.slides}
                  attachmentUrls={attachmentUrls}
                  onReachedEnd={() =>
                    setFinishedSlides((prev) => {
                      const next = new Set(prev)
                      next.add(current.id)
                      return next
                    })
                  }
                />
              ) : current.kind === 'practical' ? (
                <div className="space-y-4">
                  {current.contentHtml ? (
                    <div
                      className="lesson-prose"
                      dangerouslySetInnerHTML={{ __html: current.contentHtml }}
                    />
                  ) : null}
                  {current.practicalCriteria.length > 0 ? (
                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        What your evaluator checks
                      </p>
                      <ul className="space-y-1.5">
                        {current.practicalCriteria.map((c) => {
                          const result = current.evaluation?.criteriaResults?.[c.id]
                          return (
                            <li
                              key={c.id}
                              className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
                            >
                              {result === true ? (
                                <Check size={14} className="shrink-0 text-emerald-600" />
                              ) : result === false ? (
                                <span className="shrink-0 text-rose-500">✗</span>
                              ) : (
                                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300 dark:border-slate-700" />
                              )}
                              {c.text}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {current.status === 'completed' && current.evaluation ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/30">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                        <UserCheck size={15} /> Signed off
                        {current.evaluation.evaluatorName
                          ? ` by ${current.evaluation.evaluatorName}`
                          : ''}
                        {current.evaluation.completedAt
                          ? ` · ${new Date(current.evaluation.completedAt).toLocaleDateString()}`
                          : ''}
                      </p>
                      {current.evaluation.notes ? (
                        <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                          {current.evaluation.notes}
                        </p>
                      ) : null}
                      {current.evaluation.signatureDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={current.evaluation.signatureDataUrl}
                          alt="Evaluator signature"
                          className="mt-2 h-14 rounded border border-emerald-200 bg-white px-2 dark:border-emerald-900"
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                      This is a hands-on test — a training manager signs you off in person after you
                      demonstrate the skill.
                    </div>
                  )}
                </div>
              ) : current.kind === 'quiz' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-950">
                  <ClipboardCheck
                    size={28}
                    className="mx-auto text-slate-400 dark:text-slate-500"
                  />
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {current.assessmentTypeId
                      ? 'This lesson includes a quiz you must pass to continue.'
                      : 'No assessment is configured for this quiz.'}
                  </p>
                </div>
              ) : current.kind === 'session' ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-6 text-center dark:border-sky-900/70 dark:bg-sky-950/30">
                  <GraduationCap size={28} className="mx-auto text-sky-500" />
                  <p className="mt-2 text-sm text-sky-900 dark:text-sky-200">
                    In-person session{current.classTitle ? `: ${current.classTitle}` : ''}. Attend
                    the scheduled class, then mark it complete.
                  </p>
                </div>
              ) : current.kind === 'rich' && current.contentHtml ? (
                <div
                  className="lesson-prose"
                  dangerouslySetInnerHTML={{ __html: current.contentHtml }}
                />
              ) : (
                <LessonBlocksView blocks={asBlocks(current)} attachmentUrls={attachmentUrls} />
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                {current.status === 'completed' ? (
                  <Badge variant="success">
                    <Check size={12} className="mr-1" /> Done
                  </Badge>
                ) : current.kind === 'practical' ? (
                  <Badge variant="warning">
                    <UserCheck size={12} className="mr-1" /> Awaiting evaluator sign-off
                  </Badge>
                ) : current.kind === 'quiz' ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => startQuiz(current.id)}
                      disabled={pending || !current.assessmentTypeId}
                    >
                      {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                      Start quiz
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => complete(current.id)}
                      disabled={pending}
                    >
                      I&apos;ve passed — mark complete
                    </Button>
                  </>
                ) : current.kind === 'slides' ? (
                  <>
                    {!finishedSlides.has(current.id) && current.slides.length > 1 ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        Go through all the slides to continue
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => complete(current.id)}
                      disabled={
                        pending || (!finishedSlides.has(current.id) && current.slides.length > 1)
                      }
                    >
                      {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                      Mark complete
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={() => complete(current.id)} disabled={pending}>
                    {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                    {current.completionRule === 'acknowledge'
                      ? 'I have read & understood'
                      : current.kind === 'session'
                        ? 'Mark attended'
                        : 'Mark complete'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

// Self-directed runtime for `online` courses: there are no lessons. The learner
// opens the externally linked course, follows the instructions, then self-attests
// completion — which issues the training record + certificate.
export function OnlineCoursePlayer({
  enrollmentId,
  instructionsHtml,
  onlineUrl,
  completed,
  certificateRecordId,
}: {
  enrollmentId: string
  instructionsHtml: string | null
  onlineUrl: string | null
  completed: boolean
  certificateRecordId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function finish() {
    startTransition(async () => {
      try {
        await completeOnlineCourse(enrollmentId)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not complete the course')
      }
    })
  }

  if (completed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <Award size={24} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Course complete 🎉
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Your training record has been logged
              {certificateRecordId ? ' and a certificate issued' : ''}.
            </p>
          </div>
          {certificateRecordId ? (
            <Link href={`/training/records/${certificateRecordId}/certificate`}>
              <Button>
                <Award size={14} /> Download certificate
              </Button>
            </Link>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        {onlineUrl ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-teal-200 bg-teal-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-teal-900/50 dark:bg-teal-900/20">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Open the course
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{onlineUrl}</p>
            </div>
            <a href={onlineUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <Button type="button">
                <ExternalLink size={14} /> Open course
              </Button>
            </a>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            No course link has been configured yet. Ask your training administrator to add one.
          </div>
        )}

        {instructionsHtml ? (
          <div className="lesson-prose" dangerouslySetInnerHTML={{ __html: instructionsHtml }} />
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button type="button" onClick={finish} disabled={pending}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            I&apos;ve completed this course
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function EnrollGate({
  courseId,
  courseName,
  summary,
}: {
  courseId: string
  courseName: string
  summary: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100">
          <GraduationCap size={24} className="text-teal-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{courseName}</h2>
          {summary ? (
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
              {summary}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await enrollInCourse(courseId)
              router.refresh()
            })
          }
          disabled={pending}
        >
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Start course
        </Button>
      </CardContent>
    </Card>
  )
}
