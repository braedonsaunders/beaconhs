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
  GraduationCap,
  UserCheck,
  X,
} from 'lucide-react'
import { isRichRegion, type Slide } from '@beaconhs/db/schema'
import { LessonBlocksView, toEmbedUrl } from '../../_lib/blocks'
import { lessonProseCss } from '../../_editor/prose'
import { SlideView } from '../../_components/slide-view'
import { blocksToHtml } from '../../_editor/legacy'
import type { LessonLite, ModuleLite } from './_workspace'

export type AttachmentMeta = {
  url: string | null
  contentType: string | null
  filename: string | null
}
export type ItemContent = {
  kind: string
  contentHtml: string | null
  contentBlocks: LessonLite['contentBlocks']
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

type Effective = {
  lesson: LessonLite
  moduleTitle: string
  kind: string
  contentHtml: string | null
  blocks: LessonLite['contentBlocks']
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
  attachmentMeta,
  onClose,
}: {
  courseName: string
  modules: ModuleLite[]
  items: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
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
          blocks: item ? (item.contentBlocks ?? []) : (lesson.contentBlocks ?? []),
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
          eff={eff}
          slideIndex={slideIndex}
          attachmentUrls={attachmentUrls}
          attachmentMeta={attachmentMeta}
          quizQuestions={quizQuestions}
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
}: {
  eff: Effective
  slideIndex?: number
  attachmentUrls: Record<string, string | null>
  attachmentMeta: Record<string, AttachmentMeta>
  quizQuestions: Record<string, QuizQuestion[]>
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

  // Rich text / practical brief — a readable page.
  if (eff.kind === 'rich' || eff.kind === 'practical') {
    const html = eff.contentHtml ?? blocksToHtml(eff.blocks)
    return (
      <div className="app-scroll max-h-full w-full max-w-4xl overflow-y-auto rounded-lg bg-white px-12 py-10 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100">
        {eff.kind === 'practical' ? (
          <div className="mb-5 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <UserCheck size={15} /> Practical test — signed off by an evaluator
          </div>
        ) : null}
        {html ? (
          <div className="lesson-prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : eff.blocks.length > 0 ? (
          <LessonBlocksView blocks={eff.blocks} attachmentUrls={attachmentUrls} />
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">No content.</p>
        )}
        {eff.kind === 'practical' && eff.lesson.practicalCriteria.length > 0 ? (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Sign-off criteria
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {eff.lesson.practicalCriteria.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
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
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
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

  // Quiz — read-only question walkthrough.
  if (eff.kind === 'quiz') {
    const qs = eff.lesson.assessmentTypeId ? (quizQuestions[eff.lesson.assessmentTypeId] ?? []) : []
    return (
      <div className="app-scroll max-h-full w-full max-w-3xl overflow-y-auto rounded-lg bg-white px-10 py-8 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <ClipboardCheck size={16} className="text-teal-700 dark:text-teal-300" />{' '}
          {eff.lesson.title}
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {qs.length} question{qs.length === 1 ? '' : 's'} · learners take this interactively
          </span>
        </div>
        {qs.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No assessment configured for this quiz.
          </p>
        ) : (
          <ol className="space-y-4">
            {qs.map((q, i) => (
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
        )}
      </div>
    )
  }

  // In-person session.
  if (eff.kind === 'session') {
    return (
      <div className="rounded-lg bg-white px-10 py-8 text-center shadow-2xl dark:bg-slate-900">
        <GraduationCap size={28} className="mx-auto text-teal-700 dark:text-teal-300" />
        <p className="mt-2 font-semibold text-slate-900 dark:text-slate-100">{eff.lesson.title}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          In-person session — completed by attending the scheduled class.
        </p>
      </div>
    )
  }

  return <EmptyCard label="Nothing to preview for this element." />
}

function EmptyCard({ label }: { label: string }) {
  return <div className="rounded-lg bg-white/10 px-8 py-6 text-sm text-white/70">{label}</div>
}
