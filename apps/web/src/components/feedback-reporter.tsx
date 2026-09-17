'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleDot } from 'lucide-react'
import { Badge, Button, Textarea } from '@beaconhs/ui'
import {
  sanitizePathname,
  type FeedbackQuestion,
  type FeedbackTurnResult,
} from '@braedonsaunders/appkit-feedback'

type View =
  | { kind: 'compose' }
  | { kind: 'working'; status: string }
  | { kind: 'guidance'; result: Extract<FeedbackTurnResult, { kind: 'guidance' }> }
  | { kind: 'questions'; result: Extract<FeedbackTurnResult, { kind: 'questions' }> }
  | { kind: 'filed'; result: Extract<FeedbackTurnResult, { kind: 'filed' }> }
  | { kind: 'unavailable'; message: string }

export function FeedbackLauncher({ appVersion, locale }: { appVersion: string; locale: string }) {
  const t = useTranslations('Feedback')
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('reportIssue')}
        data-walkthrough="report-issue"
        className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <CircleDot className="h-4 w-4" />
      </button>
      <GeneratedValue
        value={
          open ? (
            <FeedbackDialog
              appVersion={appVersion}
              locale={locale}
              pathname={pathname}
              onClose={() => setOpen(false)}
            />
          ) : null
        }
      />
    </>
  )
}

function FeedbackDialog({
  appVersion,
  locale,
  pathname,
  onClose,
}: {
  appVersion: string
  locale: string
  pathname: string
  onClose: () => void
}) {
  const t = useTranslations('Feedback')
  const [text, setText] = useState('')
  const [includePage, setIncludePage] = useState(true)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'compose' })
  const busy = view.kind === 'working'
  const pageLabel = includePage ? sanitizePathname(pathname).pathname : null

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [busy, onClose])

  const title = useMemo(() => {
    if (view.kind === 'guidance') return view.result.title
    if (view.kind === 'filed') return t('filedTitle')
    if (view.kind === 'unavailable') return t('unavailableTitle')
    return t('reportIssue')
  }, [t, view])

  async function submit(next: { forceFile?: boolean; answers?: Record<string, string> }) {
    const report = text.trim()
    if (!report || busy) return
    setView({ kind: 'working', status: t('workingDefault') })
    try {
      const response = await fetch('/feedback/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: report,
          context: {
            pathname: includePage ? pathname : '/',
            pageTitle: includePage && typeof document !== 'undefined' ? document.title : undefined,
            appVersion,
            locale,
          },
          answers: next.answers ?? answers,
          forceFile: next.forceFile,
          includePage,
          sessionId,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as FeedbackTurnResult & {
        sessionId?: string
      }
      if (typeof body.sessionId === 'string') setSessionId(body.sessionId)
      setView(viewFromResult(body, t('unavailableBody')))
    } catch {
      setView({ kind: 'unavailable', message: t('unavailableBody') })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 px-4 py-10 backdrop-blur-[2px] sm:items-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2
            id="feedback-title"
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            <GeneratedValue value={title} />
          </h2>
          {view.kind === 'compose' ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('description')}</p>
          ) : null}
        </div>

        <div className="space-y-4 px-5 py-4">
          {view.kind === 'compose' || view.kind === 'working' ? (
            <>
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('placeholder')}
                rows={5}
                disabled={busy}
                autoFocus
              />
              {pageLabel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t('pageChipWithPath', { path: pageLabel })}</Badge>
                  <button
                    type="button"
                    onClick={() => setIncludePage(false)}
                    disabled={busy}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {t('removePage')}
                  </button>
                </div>
              ) : null}
              {view.kind === 'working' ? (
                <p className="text-sm text-slate-500 dark:text-slate-400" role="status">
                  {view.status}
                </p>
              ) : null}
            </>
          ) : null}

          {view.kind === 'guidance' ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {view.result.explanation}
              </p>
              {view.result.help.length > 0 ? (
                <ul className="space-y-2">
                  {view.result.help.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.url}
                        className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                      >
                        {item.title}
                      </a>
                      {item.excerpt ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.excerpt}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {view.kind === 'questions' ? (
            <QuestionsForm
              questions={view.result.questions}
              answers={answers}
              onChange={setAnswers}
            />
          ) : null}

          {view.kind === 'filed' ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">{t('filedBody')}</p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {t('issueNumber', {
                  number: view.result.issue.number,
                  title: view.result.issue.title,
                })}
              </p>
              <a
                href={view.result.issue.url}
                className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                target="_blank"
                rel="noreferrer"
              >
                {t('openIssue')}
              </a>
              {view.result.stripped.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('strippedHeading')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {view.result.stripped.join(', ')}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {view.kind === 'unavailable' ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">{view.message}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          {view.kind === 'compose' ? (
            <Button type="button" onClick={() => void submit({})} disabled={!text.trim()}>
              {t('send')}
            </Button>
          ) : null}
          {view.kind === 'working' ? (
            <Button type="button" disabled>
              {t('sending')}
            </Button>
          ) : null}
          {view.kind === 'guidance' ? (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('thatHelped')}
              </Button>
              <Button type="button" onClick={() => void submit({ forceFile: true })}>
                {t('stillABug')}
              </Button>
            </>
          ) : null}
          {view.kind === 'questions' ? (
            <Button
              type="button"
              onClick={() => void submit({ answers })}
              disabled={!hasAnswers(view.result.questions, answers)}
            >
              {t('continue')}
            </Button>
          ) : null}
          {view.kind === 'filed' || view.kind === 'unavailable' ? (
            <Button type="button" onClick={onClose}>
              {t('close')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function QuestionsForm({
  questions,
  answers,
  onChange,
}: {
  questions: FeedbackQuestion[]
  answers: Record<string, string>
  onChange: (answers: Record<string, string>) => void
}) {
  return (
    <div className="space-y-4">
      {questions.map((question) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {question.prompt}
          </legend>
          {question.choices?.length ? (
            <div className="flex flex-wrap gap-2">
              {question.choices.map((choice) => {
                const selected = answers[question.id] === choice
                return (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => onChange({ ...answers, [question.id]: choice })}
                    className={
                      selected
                        ? 'rounded-full border border-teal-600 bg-teal-50 px-3 py-1.5 text-sm text-teal-800 dark:border-teal-400 dark:bg-teal-950/40 dark:text-teal-200'
                        : 'rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }
                  >
                    {choice}
                  </button>
                )
              })}
            </div>
          ) : (
            <Textarea
              value={answers[question.id] ?? ''}
              onChange={(event) => onChange({ ...answers, [question.id]: event.target.value })}
              rows={2}
            />
          )}
        </fieldset>
      ))}
    </div>
  )
}

function viewFromResult(result: FeedbackTurnResult, unavailable: string): View {
  if (result.kind === 'guidance') return { kind: 'guidance', result }
  if (result.kind === 'questions') return { kind: 'questions', result }
  if (result.kind === 'filed') return { kind: 'filed', result }
  return { kind: 'unavailable', message: result.message || unavailable }
}

function hasAnswers(questions: FeedbackQuestion[], answers: Record<string, string>): boolean {
  return questions.every((question) => Boolean(answers[question.id]?.trim()))
}
