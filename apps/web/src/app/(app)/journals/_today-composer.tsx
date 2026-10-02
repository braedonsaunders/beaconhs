'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useRef, useState } from 'react'
import { Button } from '@beaconhs/ui'
import { JournalEditor } from './_editor'
import { createTodayEntry, updateEntry } from './_actions'

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
  const running = useRef(false)
  const id = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  async function save() {
    if (running.current || !latest.current) return
    running.current = true
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
      setOpening(true)
      await onCreated(id.current)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your journal.')
    } finally {
      running.current = false
      setSaving(false)
      setOpening(false)
    }
  }
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
          void save()
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
          <Button onClick={() => void save()}>
            <GeneratedValue value={'Retry save'} />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
