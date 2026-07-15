'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Button, Drawer, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { generateAppDraft } from './_ai-actions'

const EXAMPLES = [
  'A confined space entry permit with atmospheric readings, a PPE checklist, and a supervisor sign-off',
  'A daily pre-start vehicle inspection with pass/fail items and a photo of any defect',
  'A toolbox talk record with topic, attendees, and a signature',
  'A near-miss report with location, description, severity, and a photo',
]

// Admins + Safety Managers (forms.ai.generate) — the gallery decides whether to
// render this. Prompt → AI drafts a FormSchemaV1 → opens in the designer.
export function AiGenerateButton() {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [pending, start] = useTransition()

  function generate() {
    start(async () => {
      const res = await generateAppDraft(prompt)
      if (!res.ok || !res.templateId) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0ec7da839b3ab6')))
        return
      }
      toast.success(
        tGeneratedValue(
          res.warnings && res.warnings.length > 0
            ? tGenerated('m_122667804aeef2', { value0: res.warnings.length })
            : tGenerated('m_0b9a23a7227b17'),
        ),
      )
      setOpen(false)
      router.push(`/apps/templates/${res.templateId}/designer` as never)
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles size={15} /> <GeneratedText id="m_100dbb1b7a2770" />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_1c673096019185')}
        description={tGenerated('m_01f2de78c7500e')}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button onClick={generate} disabled={pending || prompt.trim().length < 4}>
              <Sparkles size={14} />{' '}
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_11beb293de9d2d" />
                  ) : (
                    <GeneratedText id="m_1dbb9f90b1c6f2" />
                  )
                }
              />
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            rows={5}
            value={prompt}
            placeholder={tGenerated('m_09b34a9ee341b9')}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              <GeneratedText id="m_123065dea1d3be" />
            </div>
            <GeneratedValue
              value={EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 transition-colors hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-800 dark:text-slate-400 dark:hover:border-teal-600 dark:hover:bg-teal-950/40 dark:hover:text-teal-300"
                >
                  <GeneratedValue value={ex} />
                </button>
              ))}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            <GeneratedText id="m_0a3b5aa9e0a615" />
          </p>
        </div>
      </Drawer>
    </>
  )
}
