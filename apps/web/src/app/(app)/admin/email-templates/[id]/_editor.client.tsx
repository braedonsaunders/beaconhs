'use client'

// Client wrapper around the GrapesJS email builder: name + subject, merge-token
// chips, Save (server compiles MJML), and Send test. The builder is dynamically
// imported (ssr:false) because GrapesJS touches window.

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import type { Editor } from 'grapesjs'
import { ArrowLeft, Mail, Save, Send } from 'lucide-react'
import { Button, Input, Label } from '@beaconhs/ui'
import { saveEmailTemplateDesign, sendTestEmailTemplate } from '../_actions'

const EmailBuilder = dynamic(() => import('../_builder.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-400 dark:border-slate-700">
      Loading editor…
    </div>
  ),
})

type MergeField = { key: string; label?: string; sample?: string }

export function EmailTemplateEditor({
  template,
}: {
  template: {
    id: string
    name: string
    subjectTemplate: string
    design: Record<string, unknown>
    mergeFields: MergeField[]
  }
}) {
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

  const copyToken = (k: string) => {
    void navigator.clipboard?.writeText(`{{${k}}}`)
    toast.success(`Copied {{${k}}}`)
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/admin/email-templates"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft size={18} />
          </Link>
          <Mail size={20} className="shrink-0 text-teal-600" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64 font-semibold"
            aria-label="Template name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@email.com"
            className="w-44"
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

      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject line</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. New incident at {{site}}"
        />
      </div>

      {template.mergeFields.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Tokens (click to copy):
          </span>
          {template.mergeFields.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => copyToken(f.key)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              title={f.label ? `${f.label} — click to copy` : 'Click to copy'}
            >
              {`{{${f.key}}}`}
            </button>
          ))}
        </div>
      ) : null}

      <EmailBuilder
        initialDesign={template.design}
        onReady={(ed) => {
          editorRef.current = ed
        }}
      />
    </div>
  )
}
