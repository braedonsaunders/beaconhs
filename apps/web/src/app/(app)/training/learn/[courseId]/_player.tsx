'use client'

// Learner course player — curriculum sidebar + lesson viewer. Renders bespoke
// content via the shared LessonBlocksView; quiz lessons hand off to the existing
// native assessment engine; completing the last required lesson issues the cert.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Award,
  Check,
  ClipboardCheck,
  Clock,
  GraduationCap,
  Loader2,
  PlayCircle,
} from 'lucide-react'
import { Badge, Button, Card, CardContent } from '@beaconhs/ui'
import type { LessonBlock } from '@beaconhs/db/schema'
import { LessonBlocksView } from '../../_lib/blocks'
import { enrollInCourse, markLessonComplete, startLessonQuiz } from '../_actions'
import { toast } from '@/lib/toast'

export type PlayerLesson = {
  id: string
  title: string
  kind: 'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session'
  completionRule: 'view' | 'pass' | 'acknowledge' | 'min_time'
  isRequired: boolean
  blocks: LessonBlock[]
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
    case 'rich':
      return l.blocks
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
  courseName,
  modules,
  enrollmentId,
  attachmentUrls,
  completed,
  certificateRecordId,
}: {
  courseName: string
  modules: PlayerModule[]
  enrollmentId: string
  attachmentUrls: Record<string, string | null | undefined>
  completed: boolean
  certificateRecordId: string | null
}) {
  const router = useRouter()
  const all = modules.flatMap((m) => m.lessons)
  const firstIncomplete = all.find((l) => l.status !== 'completed') ?? all[0] ?? null
  const [currentId, setCurrentId] = useState<string | null>(firstIncomplete?.id ?? null)
  const [pending, startTransition] = useTransition()

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
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Progress</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {completedCount} of {all.length} lessons complete
          </p>
        </div>

        <nav className="space-y-3">
          {modules.map((m) => (
            <div key={m.id}>
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
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
                          active ? 'bg-teal-50 text-teal-800' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="shrink-0">
                          {l.status === 'completed' ? (
                            <Check size={15} className="text-emerald-600" />
                          ) : l.kind === 'quiz' ? (
                            <ClipboardCheck size={15} className="text-slate-400" />
                          ) : (
                            <PlayCircle size={15} className="text-slate-300" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        {!l.isRequired ? (
                          <span className="text-[10px] text-slate-400">opt</span>
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
                <h2 className="text-lg font-semibold text-slate-900">Course complete 🎉</h2>
                <p className="text-sm text-slate-500">
                  Your training record has been logged{certificateRecordId ? ' and a certificate issued' : ''}.
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
            <CardContent className="py-10 text-center text-sm text-slate-500">
              This course has no lessons yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-5 py-6">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">{current.title}</h1>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
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

              {current.kind === 'quiz' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
                  <ClipboardCheck size={28} className="mx-auto text-slate-400" />
                  <p className="mt-2 text-sm text-slate-600">
                    {current.assessmentTypeId
                      ? 'This lesson includes a quiz you must pass to continue.'
                      : 'No assessment has been configured for this quiz yet.'}
                  </p>
                </div>
              ) : current.kind === 'session' ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-6 text-center">
                  <GraduationCap size={28} className="mx-auto text-sky-500" />
                  <p className="mt-2 text-sm text-sky-900">
                    In-person session{current.classTitle ? `: ${current.classTitle}` : ''}. Attend
                    the scheduled class, then mark it complete.
                  </p>
                </div>
              ) : (
                <LessonBlocksView blocks={asBlocks(current)} attachmentUrls={attachmentUrls} />
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                {current.status === 'completed' ? (
                  <Badge variant="success">
                    <Check size={12} className="mr-1" /> Done
                  </Badge>
                ) : current.kind === 'quiz' ? (
                  <>
                    <Button type="button" onClick={() => startQuiz(current.id)} disabled={pending || !current.assessmentTypeId}>
                      {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                      Start quiz
                    </Button>
                    <Button type="button" variant="outline" onClick={() => complete(current.id)} disabled={pending}>
                      I&apos;ve passed — mark complete
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
          <h2 className="text-lg font-semibold text-slate-900">{courseName}</h2>
          {summary ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{summary}</p> : null}
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
