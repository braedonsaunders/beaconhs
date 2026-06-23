'use client'

// Client shell around the GrapesJS email builder — matches the form-designer /
// document-editor shell: a full-height column with a compact top bar (name +
// test + save), a slim subject bar, and the 1/3–2/3 builder filling the rest.
// The record's fields + tables live in the builder's LEFT palette (not chips).
// The builder is dynamically imported (ssr:false) because GrapesJS touches window.

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import type { Editor } from 'grapesjs'
import { ArrowLeft, Mail, Save, Send } from 'lucide-react'
import { Button, Input } from '@beaconhs/ui'
import { saveEmailTemplateDesign, sendTestEmailTemplate } from '../_actions'

const EmailBuilder = dynamic(() => import('../_builder.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      Loading editor…
    </div>
  ),
})

type MergeField = { key: string; label?: string; sample?: string }
type Collection = { key: string; label: string; fields: { key: string; label: string }[] }

export function EmailTemplateEditor({
  template,
}: {
  template: {
    id: string
    name: string
    subjectTemplate: string
    design: Record<string, unknown>
    mjmlSource?: string | null
    mergeFields: MergeField[]
    collections?: Collection[]
    subjectLabel?: string | null
  }
}) {
  const collections = template.collections ?? []
  const editorRef = useRef<Editor | null>(null)
  const [name, setName] = useState(template.name)
  const [subject, setSubject] = useState(template.subjectTemplate)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'test'>(null)

  const snapshot = () => {
    const ed = editorRef.current
    if (!ed) return null
    return {
      design: ed.getProjectData() as Record<string, unknown>,
      mjmlSource: ed.getHtml(),
    }
  }

  const onSave = async () => {
    const snap = snapshot()
    if (!snap) {
      toast.error('Editor not ready')
      return
    }
    setBusy('save')
    try {
      const res = await saveEmailTemplateDesign({
        id: template.id,
        name,
        subjectTemplate: subject,
        design: snap.design,
        mjmlSource: snap.mjmlSource,
      })
      if (res.ok) {
        toast.success(
          res.warnings?.length ? `Saved · ${res.warnings.length} MJML notice(s)` : 'Saved',
        )
      } else {
        toast.error(res.error ?? 'Save failed')
      }
    } finally {
      setBusy(null)
    }
  }

  const onSendTest = async () => {
    if (!testTo.includes('@')) {
      toast.error('Enter a valid test email address')
      return
    }
    setBusy('test')
    try {
      const snap = snapshot()
      if (snap) {
        await saveEmailTemplateDesign({
          id: template.id,
          name,
          subjectTemplate: subject,
          design: snap.design,
          mjmlSource: snap.mjmlSource,
        })
      }
      const res = await sendTestEmailTemplate({ id: template.id, to: testTo })
      if (res.ok) toast.success('Test email queued')
      else toast.error(res.error ?? 'Failed to send test')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar — name + test + save */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href="/admin/email-templates"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Back to templates"
        >
          <ArrowLeft size={18} />
        </Link>
        <Mail size={18} className="shrink-0 text-teal-600" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-64 font-semibold"
          aria-label="Template name"
        />
        {template.subjectLabel ? (
          <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
            for <strong>{template.subjectLabel}</strong>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@email.com"
            className="h-9 w-44"
            aria-label="Send test to"
          />
          <Button variant="outline" onClick={onSendTest} disabled={busy !== null}>
            <Send size={14} /> Test
          </Button>
          <Button onClick={onSave} disabled={busy !== null}>
            <Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Subject bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
          Subject
        </span>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. New incident at {{site}}"
          className="h-8 flex-1 border-transparent bg-transparent px-1 shadow-none focus-visible:border-slate-200"
          aria-label="Subject line"
        />
      </div>

      {/* Builder — fills the rest; record fields + tables are in its left palette */}
      <div className="min-h-0 flex-1">
        <EmailBuilder
          initialDesign={template.design}
          initialMjml={template.mjmlSource ?? null}
          mergeFields={template.mergeFields}
          collections={collections}
          onReady={(ed) => {
            editorRef.current = ed
          }}
        />
      </div>
    </div>
  )
}
