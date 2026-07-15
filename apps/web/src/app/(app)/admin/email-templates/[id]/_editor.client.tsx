'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
import { serializeTemplateEditor } from '@/lib/template-builder-html'

const EmailBuilder = dynamic(() => import('../_builder.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <GeneratedText id="m_0743b8515ca318" />
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
    sourceHtml?: string | null
    mergeFields: MergeField[]
    collections?: Collection[]
    subjectLabel?: string | null
  }
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      sourceHtml: serializeTemplateEditor(ed),
    }
  }

  const onSave = async () => {
    const snap = snapshot()
    if (!snap) {
      toast.error(tGenerated('m_004a5b87102f57'))
      return
    }
    setBusy('save')
    try {
      const res = await saveEmailTemplateDesign({
        id: template.id,
        name,
        subjectTemplate: subject,
        sourceHtml: snap.sourceHtml,
      })
      if (res.ok) {
        toast.success(tGenerated('m_0a0569b726b225'))
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0731204fbd1b17')))
      }
    } catch {
      toast.error(tGenerated('m_0731204fbd1b17'))
    } finally {
      setBusy(null)
    }
  }

  const onSendTest = async () => {
    if (!testTo.includes('@')) {
      toast.error(tGenerated('m_05f32925e0af55'))
      return
    }
    setBusy('test')
    try {
      const snap = snapshot()
      if (snap) {
        const saved = await saveEmailTemplateDesign({
          id: template.id,
          name,
          subjectTemplate: subject,
          sourceHtml: snap.sourceHtml,
        })
        if (!saved.ok) {
          toast.error(tGeneratedValue(saved.error ?? tGenerated('m_0731204fbd1b17')))
          return
        }
      }
      const res = await sendTestEmailTemplate({ id: template.id, to: testTo })
      if (res.ok) toast.success(tGenerated('m_1a8e8f630d6508'))
      else toast.error(tGeneratedValue(res.error ?? tGenerated('m_124c70ffd634ae')))
    } catch {
      toast.error(tGenerated('m_124c70ffd634ae'))
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
          aria-label={tGenerated('m_1c2522416ac1b6')}
        >
          <ArrowLeft size={18} />
        </Link>
        <Mail size={18} className="shrink-0 text-teal-600" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="h-9 w-64 font-semibold"
          aria-label={tGenerated('m_1042308a24d5eb')}
        />
        <GeneratedValue
          value={
            template.subjectLabel ? (
              <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
                <GeneratedText id="m_0c496181655d02" />{' '}
                <strong>
                  <GeneratedValue value={template.subjectLabel} />
                </strong>
              </span>
            ) : null
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            type="email"
            maxLength={254}
            placeholder={tGenerated('m_140cd9aafed457')}
            className="h-9 w-44"
            aria-label={tGenerated('m_02c0561119b6b6')}
          />
          <Button variant="outline" onClick={onSendTest} disabled={busy !== null}>
            <Send size={14} /> <GeneratedText id="m_12b6e101ca2a00" />
          </Button>
          <Button onClick={onSave} disabled={busy !== null}>
            <Save size={14} />{' '}
            <GeneratedValue
              value={
                busy === 'save' ? (
                  <GeneratedText id="m_106811f2aac664" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </div>
      </div>

      {/* Subject bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_1928431de4aaf1" />
        </span>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={998}
          placeholder={tGenerated('m_06b6d44e9431aa')}
          className="h-8 flex-1 border-transparent bg-transparent px-1 shadow-none focus-visible:border-slate-200"
          aria-label={tGenerated('m_0d50b146c4f171')}
        />
      </div>

      {/* Builder — fills the rest; record fields + tables are in its left palette */}
      <div className="min-h-0 flex-1">
        <EmailBuilder
          initialHtml={template.sourceHtml ?? null}
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
