'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@beaconhs/ui'
import { JournalEditor } from './_editor'
import { createTodayEntry, updateEntry } from './_actions'
import { FLUSH_RECORD_SAVES, forgetRecordSave, trackRecordSave } from '@/lib/pending-record-saves'

/** A fresh editor needs no database row until the author actually writes. */
export function TodayComposer({
  aiEnabled,
  onCreated,
  onBrowse,
}: {
  aiEnabled: boolean
  onCreated: (id: string) => Promise<void>
  onBrowse: () => void
}) {
  const latest = useRef('')
  const running = useRef<Promise<void> | null>(null)
  const persisted = useRef('')
  const [saveKey] = useState(() => Symbol('new-journal-save'))
  const id = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  function save(): Promise<void> {
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
      do {
        saved = latest.current
        const result = await updateEntry({ id: id.current, patch: { bodyHtml: saved } })
        if (!result.ok) throw new Error(result.error)
      } while (latest.current !== saved)
      persisted.current = saved
      setOpening(true)
      await onCreated(id.current)
    } catch (error) {
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
      if (!running.current && latest.current === persisted.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener(FLUSH_RECORD_SAVES, flush)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener(FLUSH_RECORD_SAVES, flush)
      window.removeEventListener('beforeunload', beforeUnload)
      if (running.current || latest.current !== persisted.current) flush()
      else forgetRecordSave(saveKey)
    }
  }, [saveKey])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          <GeneratedValue value={'Today’s journal'} />
        </h2>
        <Button variant="outline" onClick={onBrowse}>
          <GeneratedValue value={'Browse journals'} />
        </Button>
      </div>
      <p className="text-sm text-slate-500">
        <GeneratedValue
          value={
            'Start writing. Your new entry saves automatically. Older drafts are available in Browse journals.'
          }
        />
      </p>
      <JournalEditor
        initialHtml=""
        editable={!opening}
        aiEnabled={aiEnabled}
        onChange={(html, text) => {
          if (!text.trim() && !id.current) return
          latest.current = html
          void save().catch(() => {})
        }}
      />
      {saving ? (
        <p role="status">
          <GeneratedValue value={'Saving…'} />
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => void save().catch(() => {})}>
            <GeneratedValue value={'Retry save'} />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
