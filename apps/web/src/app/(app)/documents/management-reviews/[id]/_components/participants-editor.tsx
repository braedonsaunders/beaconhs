'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Label, Select } from '@beaconhs/ui'

type Member = { id: string; label: string }

export function ParticipantsEditor({
  members,
  value,
  onChange,
}: {
  members: Member[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [pending, setPending] = useState('')
  const byId = new Map(members.map((m) => [m.id, m]))

  function add() {
    if (!pending || value.includes(pending)) return
    onChange([...value, pending])
    setPending('')
  }
  function remove(id: string) {
    onChange(value.filter((x) => x !== id))
  }

  return (
    <div className="space-y-2 text-sm">
      <Label>Participants</Label>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select value={pending} onChange={(e) => setPending(e.target.value)}>
            <option value="">— pick a participant —</option>
            {members
              .filter((m) => !value.includes(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={add}>
          <Plus size={14} /> Add
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-slate-500">No participants added.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {value.map((id) => {
            const m = byId.get(id)
            return (
              <li key={id}>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <span>{m?.label ?? id.slice(0, 8)}</span>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    className="ml-1 rounded p-0.5 hover:bg-slate-200"
                    aria-label="Remove"
                  >
                    <Trash2 size={10} className="text-red-500" />
                  </button>
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
