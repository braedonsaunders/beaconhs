'use client'

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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [pending, start] = useTransition()

  function generate() {
    start(async () => {
      const res = await generateAppDraft(prompt)
      if (!res.ok || !res.templateId) {
        toast.error(res.error ?? 'Could not generate the app')
        return
      }
      toast.success(
        res.warnings && res.warnings.length > 0
          ? `App drafted with ${res.warnings.length} note(s) to review`
          : 'App drafted — opening the designer',
      )
      setOpen(false)
      router.push(`/apps/templates/${res.templateId}/designer` as never)
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles size={15} /> Generate with AI
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Generate an App with AI"
        description="Describe the app. The AI drafts it for refinement in the designer."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={pending || prompt.trim().length < 4}>
              <Sparkles size={14} /> {pending ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            rows={5}
            value={prompt}
            placeholder="e.g. A confined space entry permit with atmospheric readings, a PPE checklist, and a supervisor sign-off."
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">Try one:</div>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 transition-colors hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-800 dark:text-slate-400 dark:hover:border-teal-600 dark:hover:bg-teal-950/40 dark:hover:text-teal-300"
              >
                {ex}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Produces an editable draft (never auto-published). Uses your workspace's configured AI
            provider.
          </p>
        </div>
      </Drawer>
    </>
  )
}
