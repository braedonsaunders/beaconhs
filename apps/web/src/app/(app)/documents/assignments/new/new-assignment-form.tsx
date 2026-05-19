'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { createAssignment, type AudienceItem } from './actions'

type Option = { id: string; label: string; sub?: string }

type Props = {
  documents: Option[]
  roles: { key: string; name: string }[]
  trades: Option[]
  departments: Option[]
  people: Option[]
}

export function NewAssignmentForm({ documents, roles, trades, departments, people }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [audience, setAudience] = useState<AudienceItem[]>([])
  const [pendingType, setPendingType] = useState<AudienceItem['type']>('role')
  const [pendingValue, setPendingValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addAudience() {
    if (pendingType === 'everyone') {
      if (audience.some((a) => a.type === 'everyone')) return
      setAudience((a) => [...a, { type: 'everyone', entityKey: 'all' }])
      return
    }
    if (!pendingValue) return
    if (audience.some((a) => a.type === pendingType && a.entityKey === pendingValue)) return
    setAudience((a) => [...a, { type: pendingType, entityKey: pendingValue }])
    setPendingValue('')
  }

  function removeAudience(idx: number) {
    setAudience((a) => a.filter((_, i) => i !== idx))
  }

  function audienceLabel(row: AudienceItem): string {
    if (row.type === 'everyone') return 'Everyone (all active people)'
    if (row.type === 'role') {
      const r = roles.find((x) => x.key === row.entityKey)
      return `Role · ${r?.name ?? row.entityKey}`
    }
    if (row.type === 'trade') {
      const t = trades.find((x) => x.id === row.entityKey)
      return `Trade · ${t?.label ?? row.entityKey}`
    }
    if (row.type === 'department') {
      const d = departments.find((x) => x.id === row.entityKey)
      return `Department · ${d?.label ?? row.entityKey}`
    }
    const p = people.find((x) => x.id === row.entityKey)
    return `Person · ${p?.label ?? row.entityKey}`
  }

  function valueOptions(): { value: string; label: string }[] {
    if (pendingType === 'role') {
      return roles.map((r) => ({ value: r.key, label: r.name }))
    }
    if (pendingType === 'trade') return trades.map((t) => ({ value: t.id, label: t.label }))
    if (pendingType === 'department')
      return departments.map((d) => ({ value: d.id, label: d.label }))
    if (pendingType === 'person')
      return people.map((p) => ({ value: p.id, label: `${p.label}${p.sub ? ' · ' + p.sub : ''}` }))
    return []
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!documentId) {
      setError('Pick a document')
      return
    }
    if (audience.length === 0) {
      setError('Add at least one audience target')
      return
    }
    start(async () => {
      const result = await createAssignment({
        documentId,
        title: title.trim() || null,
        notes: notes.trim() || null,
        dueOn: dueOn || null,
        audience,
      })
      if (!('ok' in result) || !result.ok) {
        setError(('error' in result && result.error) || 'Failed to create assignment')
        return
      }
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Pick a document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="documentId">Document *</Label>
            <Select
              id="documentId"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              required
            >
              <option value="" disabled>
                Pick a document…
              </option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title (optional)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Falls back to document title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueOn">Due date</Label>
              <Input
                id="dueOn"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Users size={16} /> Audience
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            Add one or more audience targets. The resolved people set is the union of every row;
            duplicates are de-duped.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="pendingType">Type</Label>
              <Select
                id="pendingType"
                value={pendingType}
                onChange={(e) => {
                  setPendingType(e.target.value as AudienceItem['type'])
                  setPendingValue('')
                }}
              >
                <option value="role">Role</option>
                <option value="trade">Trade</option>
                <option value="department">Department</option>
                <option value="person">Person</option>
                <option value="everyone">Everyone</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pendingValue">Pick</Label>
              {pendingType === 'everyone' ? (
                <Input
                  id="pendingValue"
                  value="All active people"
                  disabled
                  className="bg-slate-50"
                />
              ) : (
                <Select
                  id="pendingValue"
                  value={pendingValue}
                  onChange={(e) => setPendingValue(e.target.value)}
                >
                  <option value="">— pick —</option>
                  {valueOptions().map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <Button type="button" variant="outline" onClick={addAudience}>
              <Plus size={14} /> Add
            </Button>
          </div>

          {audience.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
              No audience yet — add at least one above.
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {audience.map((a, idx) => (
                <li
                  key={`${a.type}-${a.entityKey}-${idx}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary">{a.type}</Badge>
                    <span className="text-slate-900">{audienceLabel(a)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAudience(idx)}
                    aria-label="Remove"
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href="/documents/assignments">
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create assignment'}
        </Button>
      </div>
    </form>
  )
}
