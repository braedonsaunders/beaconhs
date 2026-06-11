'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardContent, Input, Label, Textarea } from '@beaconhs/ui'

type Row = {
  id: string
  reference: string
  occurredAt: string
  typeName: string
  siteName: string
  supervisorName: string
  signedCount: number
  totalSignatures: number
}

export function SignedReportBuilder({
  assessments,
  buildAction,
}: {
  assessments: Row[]
  buildAction: (formData: FormData) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [emails, setEmails] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function build() {
    setErr(null)
    if (!title.trim()) {
      setErr('Title is required')
      return
    }
    if (selected.length === 0) {
      setErr('Pick at least one assessment')
      return
    }
    const fd = new FormData()
    fd.set('title', title)
    fd.set('description', description)
    fd.set('assessmentIds', selected.join(','))
    fd.set('recipientEmails', emails)
    start(async () => {
      await buildAction(fd)
      setSelected([])
      setTitle('')
      setDescription('')
      setEmails('')
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bundle title *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Week of 2026-05-11 — Refinery JSHA pack"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Recipient emails (comma separated)</Label>
              <Input
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="ops-mgr@…, safety@…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          {err ? <div className="text-xs text-red-600">{err}</div> : null}
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-slate-500">{selected.length} selected</span>
            <Button type="button" onClick={build} disabled={pending}>
              {pending ? 'Building…' : 'Build bundle'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2 text-left">Ref</th>
              <th className="px-2 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-left">Type</th>
              <th className="px-2 py-2 text-left">Site</th>
              <th className="px-2 py-2 text-left">Supervisor</th>
              <th className="px-2 py-2 text-left">Signatures</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assessments.map((a) => (
              <tr key={a.id} className={selected.includes(a.id) ? 'bg-teal-50/60' : ''}>
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={() => toggle(a.id)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                </td>
                <td className="px-2 py-2 font-mono text-xs">{a.reference}</td>
                <td className="px-2 py-2">{new Date(a.occurredAt).toLocaleDateString()}</td>
                <td className="px-2 py-2 text-slate-600">{a.typeName}</td>
                <td className="px-2 py-2 text-slate-600">{a.siteName}</td>
                <td className="px-2 py-2 text-slate-600">{a.supervisorName}</td>
                <td className="px-2 py-2 text-xs">
                  {a.signedCount}/{a.totalSignatures}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
