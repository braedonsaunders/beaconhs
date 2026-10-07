'use client'

import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@beaconhs/ui'
import { unstable_rethrow } from 'next/navigation'
import { JournalSubmitButton } from './_submit-button'
import { JournalSupervisorField } from './_supervisor-field'
import { JournalEditor } from './_editor'
import { createTodayEntry, submitEntry, updateEntry } from './_actions'
import { FLUSH_RECORD_SAVES, forgetRecordSave, trackRecordSave } from '@/lib/pending-record-saves'

/** A fresh editor needs no database row until the author actually writes. */
export function TodayComposer({
  aiEnabled,
  canSubmit,
  onCreated,
  onBrowse,
}: {
  aiEnabled: boolean
  canSubmit: boolean
  onCreated: (id: string) => Promise<void>
  onBrowse: () => void
}) {
  const translate = useGeneratedValueTranslations()
  const submitIntent = useRef(false)
  const submittedRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [hasText, setHasText] = useState(false)
  const [supervisorPersonId, setSupervisorPersonId] = useState<string | null>(null)
  const supervisor = useRef<string | null>(null)
  const persistedSupervisor = useRef<string | null>(null)
  const latest = useRef('')
  const running = useRef<Promise<void> | null>(null)
  const persisted = useRef('')
  const [saveKey] = useState(() => Symbol('new-journal-save'))
  const id = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  function save(): Promise<void> {
    if (submittedRef.current) return Promise.resolve()
    if (running.current) return running.current
    if (!latest.current) return Promise.resolve()
    const task = trackRecordSave(saveKey, persist())
    running.current = task
    void task.then(
      () => {
        running.current = null
      },
      () => {
        running.current = null
      },
    )
    return task
  }

  async function persist() {
    setSaving(true)
    setError(null)
    try {
      if (!id.current) {
        const created = await createTodayEntry()
        if (!created.ok) throw new Error(created.error)
        id.current = created.id
      }
      let saved: string
      let savedSupervisor: string | null
      do {
        saved = latest.current
        savedSupervisor = supervisor.current
        const result = await updateEntry({
          id: id.current,
          patch: { bodyHtml: saved, supervisorPersonId: savedSupervisor },
        })
        if (!result.ok) throw new Error(result.error)
      } while (latest.current !== saved || supervisor.current !== savedSupervisor)
      persisted.current = saved
      persistedSupervisor.current = savedSupervisor
      if (!submitIntent.current) {
        setOpening(true)
        await onCreated(id.current)
      }
    } catch (error) {
      unstable_rethrow(error)
      setError(error instanceof Error ? error.message : 'Could not save your journal.')
      throw error
    } finally {
      setSaving(false)
      setOpening(false)
    }
  }
  const saveLatest = useEffectEvent(() => save().catch(() => {}))
  useEffect(() => {
    const flush = () => void saveLatest()
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !submitIntent.current &&
        !running.current &&
        latest.current === persisted.current &&
        (!id.current || supervisor.current === persistedSupervisor.current)
      )
        return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener(FLUSH_RECORD_SAVES, flush)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener(FLUSH_RECORD_SAVES, flush)
      window.removeEventListener('beforeunload', beforeUnload)
      if (
        running.current ||
        latest.current !== persisted.current ||
        (id.current && supervisor.current !== persistedSupervisor.current)
      )
        flush()
      else forgetRecordSave(saveKey)
    }
  }, [saveKey])

  async function submit() {
    if (submitIntent.current || !hasText || !canSubmit || !supervisor.current) return
    submitIntent.current = true
    setSubmitting(true)
    setError(null)
    try {
      // A pending create/write stays on this screen until submission finishes.
      // The save loop drains all text entered before the author tapped Submit.
      await save()
      if (!id.current) throw new Error('Could not save your journal.')
      const result = await submitEntry(id.current)
      if (!result.ok) throw new Error(result.error)
      submittedRef.current = true
      setSubmitted(true)
      await openSubmitted()
    } catch (error) {
      unstable_rethrow(error)
      setError(error instanceof Error ? error.message : 'Could not submit your journal.')
    } finally {
      submitIntent.current = false
      setSubmitting(false)
    }
  }

  async function openSubmitted() {
    if (!id.current) return
    setOpening(true)
    setError(null)
    try {
      await onCreated(id.current)
    } catch (error) {
      unstable_rethrow(error)
      setError(error instanceof Error ? error.message : 'Could not open your journal.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900">
      <div className="shrink-0 space-y-2 border-b border-slate-200 p-3 sm:px-6 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            <GeneratedValue value={'Today’s journal'} />
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              disabled={submitting || opening}
              onClick={onBrowse}
            >
              <GeneratedValue value={'Browse journals'} />
            </Button>
            {canSubmit && !submitted ? (
              <JournalSubmitButton
                submitting={submitting}
                disabled={!hasText || !supervisorPersonId || opening}
                onClick={() => void submit()}
              />
            ) : null}
          </div>
        </div>
        <p className="text-sm text-slate-500">
          <GeneratedValue
            value={
              canSubmit
                ? 'Your words save as a draft. Tap Submit when you are finished.'
                : 'Your words save automatically as a draft.'
            }
          />
        </p>
        <div className="max-w-sm">
          <JournalSupervisorField
            value={supervisorPersonId}
            disabled={submitting || opening || submitted}
            requiredForSubmission={!submitted}
            onChange={(value) => {
              supervisor.current = value
              setSupervisorPersonId(value)
              if (latest.current) void save().catch(() => {})
            }}
          />
        </div>
        {submitted ? (
          <p role="status" className="text-sm text-teal-700 dark:text-teal-300">
            <GeneratedValue value={'Submitted'} />
          </p>
        ) : saving ? (
          <p role="status" className="text-sm text-slate-500">
            <GeneratedValue value={'Saving…'} />
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            <p>{translate(error)}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting || opening}
              onClick={() => void (submitted ? openSubmitted() : save().catch(() => {}))}
            >
              <GeneratedValue value={submitted ? 'Retry opening journal' : 'Retry save'} />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <JournalEditor
          initialHtml=""
          editable={!opening && !submitting && !submitted}
          aiEnabled={aiEnabled}
          onChange={(html, text) => {
            if (submitIntent.current || submitted) return
            const meaningful = Boolean(text.trim())
            setHasText(meaningful)
            if (!meaningful && !id.current) return
            latest.current = html
            void save().catch(() => {})
          }}
        />
      </div>
    </div>
  )
}
