'use client'

// Course presenter — instructor "Play" mode. Walks the ENTIRE course like a
// PowerPoint preview: slideshows advance slide-by-slide, then flow straight
// into the next element (text pages, videos, PDFs, images, quizzes, practical
// briefs, sessions). Arrow keys / click zones navigate across everything.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  GraduationCap,
  ListChecks,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import type { Slide } from '@beaconhs/db/schema'
import { toEmbedUrl } from '../../_lib/blocks'
import { lessonProseCss } from '../../_editor/prose'
import { SlideView } from '../../_components/slide-view'
import type { LessonLite, ModuleLite } from './_workspace'
import { RawImage } from '@/components/raw-image'

export type AttachmentMeta = {
  url: string | null
  contentType: string | null
  filename: string | null
}
export type ItemContent = {
  kind: string
  contentHtml: string | null
  slides: Slide[]
  embedUrl: string | null
  attachmentId: string | null
}
export type QuizQuestion = {
  id: string
  prompt: string
  kind: string
  options: { value: string; label: string }[] | null
}
export type AssessmentMeta = {
  name: string
  passingScore: number
  questionCount: number
}

type Effective = {
  lesson: LessonLite
  moduleTitle: string
  kind: string
  contentHtml: string | null
  slides: Slide[]
  embedUrl: string | null
  attachmentId: string | null
}
type Step = { eff: Effective; slideIndex?: number }

export function CoursePresenter({
  courseName,
  modules,
  items,
  quizQuestions,
  assessmentMeta,
  attachmentMeta,
  onClose,
}: {
  courseName: string
  modules: ModuleLite[]
  items: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
  attachmentMeta: Record<string, AttachmentMeta>
  onClose: () => void
}) {
  const attachmentUrls = useMemo(
    () => Object.fromEntries(Object.entries(attachmentMeta).map(([id, m]) => [id, m.url])),
    [attachmentMeta],
  )

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = []
    for (const mod of modules) {
      for (const lesson of mod.lessons) {
        const item = lesson.contentItemId ? items[lesson.contentItemId] : null
        const eff: Effective = {
          lesson,
          moduleTitle: mod.title,
          kind: item ? item.kind : lesson.kind,
          contentHtml: item ? item.contentHtml : lesson.contentHtml,
          slides: item ? (item.slides ?? []) : (lesson.slides ?? []),
          embedUrl: item ? item.embedUrl : lesson.embedUrl,
          attachmentId: item ? item.attachmentId : lesson.attachmentId,
        }
        if (eff.kind === 'slides' && eff.slides.length > 0) {
          eff.slides.forEach((_, si) => out.push({ eff, slideIndex: si }))
        } else {
          out.push({ eff })
        }
      }
    }
    return out
  }, [modules, items])

  const [idx, setIdx] = useState(0)
  const total = steps.length
  const step = steps[Math.min(idx, total - 1)] ?? null
  const containerRef = useRef<HTMLDivElement>(null)

  const go = useCallback(
    (d: number) => setIdx((c) => Math.max(0, Math.min(total - 1, c + d))),
    [total],
  )

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault()
      go(1)
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'Home') setIdx(0)
    else if (e.key === 'End') setIdx(total - 1)
    else if (e.key === 'Escape') onClose()
  }

  if (!step) {
    return (
      <Overlay onClose={onClose}>
        <p className="text-sm text-white/70">This course has no content.</p>
      </Overlay>
    )
  }

  const { eff, slideIndex } = step
  const slideTotal = eff.kind === 'slides' ? eff.slides.length : 0

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[80] flex flex-col bg-slate-950 outline-none"
    >
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />

      {/* top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 px-4 text-white/80">
        <span className="truncate text-sm font-semibold text-white">{courseName}</span>
        <span className="truncate text-xs text-white/50">
          {eff.moduleTitle} · {eff.lesson.title}
          {slideIndex != null ? ` · slide ${slideIndex + 1}/${slideTotal}` : ''}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close presenter"
          className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X size={17} />
        </button>
      </div>

      {/* stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pt-2 pb-14">
        <Stage
          key={`${eff.lesson.id}:${slideIndex ?? ''}`}
          eff={eff}
          slideIndex={slideIndex}
          attachmentUrls={attachmentUrls}
          attachmentMeta={attachmentMeta}
          quizQuestions={quizQuestions}
          assessmentMeta={assessmentMeta}
        />

        {/* click zones */}
        <button
          type="button"
          aria-label="Previous"
          onClick={() => go(-1)}
          className="absolute inset-y-0 left-0 w-12 cursor-w-resize opacity-0"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={() => go(1)}
          className="absolute inset-y-0 right-0 w-12 cursor-e-resize opacity-0"
        />
      </div>

      {/* bottom bar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-3">
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-teal-400 transition-all duration-300"
            style={{ width: `${((idx + 1) / total) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-1 text-white/80">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={idx === 0}
            aria-label="Previous"
            className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft size={17} />
          </button>
          <span className="text-xs tabular-nums">
            {idx + 1} / {total}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={idx >= total - 1}
            aria-label="Next"
            className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={17} />
      </button>
      {children}
    </div>
  )
}

function Stage({
  eff,
  slideIndex,
  attachmentUrls,
  attachmentMeta,
  quizQuestions,
  assessmentMeta,
}: {
  eff: Effective
  slideIndex?: number
  attachmentUrls: Record<string, string | null>
  attachmentMeta: Record<string, AttachmentMeta>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
}) {
  // Slides — one slide per step, PowerPoint-style.
  if (eff.kind === 'slides') {
    const slide = slideIndex != null ? eff.slides[slideIndex] : null
    if (!slide) return <EmptyCard label="No slides in this slideshow." />
    return (
      <div className="max-h-full w-full max-w-[160vh]">
        <SlideView
          slide={slide}
          attachmentUrls={attachmentUrls}
          className="rounded-lg shadow-2xl"
        />
      </div>
    )
  }

  // Rich text — a readable page.
  if (eff.kind === 'rich') {
    const html = eff.contentHtml
    return (
      <div className="app-scroll max-h-full w-full max-w-4xl overflow-y-auto rounded-lg bg-white px-12 py-10 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100">
        {html ? (
          <div className="lesson-prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">No content.</p>
        )}
      </div>
    )
  }

  // Practical exam — a classroom activity guide. Shows the brief, then the
  // sign-off criteria the evaluator marks hands-on. Not self-completed.
  if (eff.kind === 'practical') {
    const html = eff.contentHtml
    return (
      <ActivityGuide
        tone="amber"
        icon={<UserCheck size={26} />}
        badge="Practical exam"
        title={eff.lesson.title}
        subtitle="Hands-on — an evaluator watches each learner and signs them off against the criteria below."
      >
        {html ? (
          <div className="lesson-prose mt-5 text-left" dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
        {eff.lesson.practicalCriteria.length > 0 ? (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left dark:border-slate-700 dark:bg-slate-800/50">
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Sign-off criteria ({eff.lesson.practicalCriteria.length})
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {eff.lesson.practicalCriteria.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="mt-5 text-xs text-slate-400 dark:text-slate-500">
          Record each learner&apos;s result in the course&apos;s Evaluations grid.
        </p>
      </ActivityGuide>
    )
  }

  // Video — uploaded file or hosted embed.
  if (eff.kind === 'video') {
    const fileUrl = eff.attachmentId ? attachmentUrls[eff.attachmentId] : null
    const url = eff.embedUrl || fileUrl
    if (!url) return <EmptyCard label="No video configured." />
    const hosted = /youtube|youtu\.be|vimeo/.test(url)
    return (
      <div className="aspect-video w-full max-w-[160vh] overflow-hidden rounded-lg shadow-2xl">
        {hosted ? (
          <iframe
            src={toEmbedUrl(url)}
            className="h-full w-full"
            allowFullScreen
            title={eff.lesson.title}
          />
        ) : (
          <video src={url} controls autoPlay className="h-full w-full bg-black" />
        )}
      </div>
    )
  }

  // File — PDFs render inline; other files get a download card.
  if (eff.kind === 'file') {
    const meta = eff.attachmentId ? attachmentMeta[eff.attachmentId] : null
    if (!meta?.url) return <EmptyCard label="No file attached." />
    const isPdf =
      (meta.contentType ?? '').includes('pdf') ||
      (meta.filename ?? '').toLowerCase().endsWith('.pdf')
    const isImage = (meta.contentType ?? '').startsWith('image/')
    if (isPdf) {
      return (
        <iframe
          src={meta.url}
          className="h-full w-full max-w-5xl rounded-lg bg-white shadow-2xl dark:bg-slate-900"
          title={eff.lesson.title}
        />
      )
    }
    if (isImage) {
      return (
        <RawImage
          src={meta.url}
          alt={eff.lesson.title}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
      )
    }
    return (
      <a
        href={meta.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg bg-white px-6 py-5 text-slate-800 shadow-2xl hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <Download size={18} className="text-teal-700 dark:text-teal-300" />
        <span className="font-medium">{meta.filename ?? eff.lesson.title}</span>
      </a>
    )
  }

  // Embedded page.
  if (eff.kind === 'embed') {
    if (!eff.embedUrl) return <EmptyCard label="No URL configured." />
    return (
      <iframe
        src={toEmbedUrl(eff.embedUrl)}
        className="h-full w-full max-w-[160vh] rounded-lg bg-white shadow-2xl dark:bg-slate-900"
        title={eff.lesson.title}
      />
    )
  }

  // Quiz — a classroom "assessment break" title card. Learners complete it
  // individually on their own device; the room does not see the answers. The
  // instructor can reveal the questions afterwards for review.
  if (eff.kind === 'quiz') {
    const typeId = eff.lesson.assessmentTypeId
    const qs = typeId ? (quizQuestions[typeId] ?? []) : []
    const meta = typeId ? assessmentMeta[typeId] : undefined
    return <QuizGuide title={eff.lesson.title} meta={meta} questions={qs} />
  }

  // In-person session — a classroom activity guide.
  if (eff.kind === 'session') {
    return (
      <ActivityGuide
        tone="teal"
        icon={<GraduationCap size={26} />}
        badge="In-person session"
        title={eff.lesson.title}
        subtitle="Delivered in person as part of the scheduled class."
      />
    )
  }

  // Every element kind is handled above; this is a defensive fallback only.
  return (
    <ActivityGuide
      tone="slate"
      icon={<GraduationCap size={26} />}
      badge="Lesson"
      title={eff.lesson.title}
      subtitle="Discuss this item with the class."
    />
  )
}

function EmptyCard({ label }: { label: string }) {
  return <div className="rounded-lg bg-white/10 px-8 py-6 text-sm text-white/70">{label}</div>
}

// A full-screen classroom activity card: coloured badge, big title, subtitle,
// and optional detail children. Used for practicals, quizzes, and sessions —
// every non-content element gets a clear in-room representation.
function ActivityGuide({
  tone,
  icon,
  badge,
  title,
  subtitle,
  children,
}: {
  tone: 'teal' | 'amber' | 'slate'
  icon: React.ReactNode
  badge: string
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  const toneCls = {
    teal: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  }[tone]
  return (
    <div className="app-scroll max-h-full w-full max-w-3xl overflow-y-auto rounded-xl bg-white px-10 py-9 text-center shadow-2xl dark:bg-slate-900">
      <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${toneCls}`}>
        {icon}
      </span>
      <p
        className={`mt-4 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${toneCls}`}
      >
        {badge}
      </p>
      <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      {subtitle ? (
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      ) : null}
      {children}
    </div>
  )
}

function QuizGuide({
  title,
  meta,
  questions,
}: {
  title: string
  meta: AssessmentMeta | undefined
  questions: QuizQuestion[]
}) {
  const [revealed, setRevealed] = useState(false)
  const count = meta?.questionCount ?? questions.length
  return (
    <ActivityGuide
      tone="teal"
      icon={<ClipboardCheck size={26} />}
      badge="Assessment"
      title={meta?.name || title}
      subtitle="Everyone completes this individually now — open My Training on your own device, pick this course, and submit your answers."
    >
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <ListChecks size={13} /> {count} question{count === 1 ? '' : 's'}
        </span>
        {meta ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Users size={13} /> Pass mark {meta.passingScore}%
          </span>
        ) : null}
      </div>
      {questions.length > 0 ? (
        <div className="mt-6 text-left">
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="mx-auto flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            {revealed ? 'Hide questions' : 'Show questions (instructor)'}
          </button>
          {revealed ? (
            <ol className="mt-4 space-y-3">
              {questions.map((q, i) => (
                <li
                  key={q.id}
                  className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {i + 1}. {q.prompt}
                  </p>
                  {q.options && q.options.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {q.options.map((o, oi) => (
                        <li
                          key={o.value}
                          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
                        >
                          <span className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 text-[10px] font-semibold dark:border-slate-700">
                            {String.fromCharCode(65 + oi)}
                          </span>
                          {o.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      {q.kind === 'true_false' ? 'True / False' : 'Free answer'}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-xs text-slate-400 dark:text-slate-500">
          No assessment configured for this quiz yet.
        </p>
      )}
    </ActivityGuide>
  )
}
