'use client'

import { useState, useTransition } from 'react'
import { Button, Input, Textarea } from '@beaconhs/ui'
import { Pencil } from 'lucide-react'

// Inline editable text / textarea bound to the generic updateTextField action.
// Renders a read-only display until clicked; then a small edit form.
export function InlineField({
  id,
  field,
  initialValue,
  label,
  multiline = false,
  placeholder,
  disabled,
  updateAction,
}: {
  id: string
  field: string
  initialValue: string | null
  label: string
  multiline?: boolean
  placeholder?: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<string>(initialValue ?? '')
  const [pending, start] = useTransition()

  function save() {
    const fd = new FormData()
    fd.set('id', id)
    fd.set('field', field)
    fd.set('value', value)
    start(async () => {
      await updateAction(fd)
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
            {initialValue ? initialValue : <span className="text-slate-400">—</span>}
          </div>
        </div>
        {disabled ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={12} /> Edit
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      {multiline ? (
        <Textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      ) : (
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue(initialValue ?? '')
            setEditing(false)
          }}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
