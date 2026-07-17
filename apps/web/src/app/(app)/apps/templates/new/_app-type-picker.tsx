'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The primary "what do you want to build?" picker on the New App page. Choosing
// a type seeds a kind-specific starter schema (server-side) and drops the user
// into the designer already shaped for that type.

import { useState, useTransition } from 'react'
import {
  ArrowRight,
  Blocks,
  FileText,
  ListChecks,
  Sparkles,
  Table2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { Button, Input, Label } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { createApp, type AppKind } from './_actions'
import { CANONICAL_TEMPLATES } from '@beaconhs/db/canonical-templates'

type TypeDef = {
  kind: AppKind
  title: string
  blurb: string
  icon: LucideIcon
  accent: string
}

const TYPES: TypeDef[] = [
  {
    kind: 'form',
    title: 'Form',
    blurb: 'A classic single-page form. Sections of fields, one submit.',
    icon: FileText,
    accent: 'text-teal-700 bg-teal-50 group-hover:bg-teal-100',
  },
  {
    kind: 'wizard',
    title: 'Wizard',
    blurb: 'A multi-step flow (Step 1 → 2 → 3) with a progress bar.',
    icon: Blocks,
    accent: 'text-indigo-700 bg-indigo-50 group-hover:bg-indigo-100',
  },
  {
    kind: 'checklist',
    title: 'Checklist',
    blurb: 'Yes/No items with comments — built for inspections + audits.',
    icon: ListChecks,
    accent: 'text-emerald-700 bg-emerald-50 group-hover:bg-emerald-100',
  },
  {
    kind: 'register',
    title: 'Register',
    blurb: 'An append-and-browse tabular log. Add a row per entry.',
    icon: Table2,
    accent: 'text-amber-700 bg-amber-50 group-hover:bg-amber-100',
  },
  {
    kind: 'mini_app',
    title: 'Mini-app',
    blurb: 'A composed multi-section surface for power users.',
    icon: WalletCards,
    accent: 'text-violet-700 bg-violet-50 group-hover:bg-violet-100',
  },
]

export function AppTypePicker() {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [selected, setSelected] = useState<AppKind>('form')
  const [canonicalKey, setCanonicalKey] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, start] = useTransition()

  const active = TYPES.find((t) => t.kind === selected)!

  const create = () => {
    if (name.trim().length < 2) {
      toast.error(tGenerated('m_11ba77cdb1cd08'))
      return
    }
    start(async () => {
      const res = await createApp({ kind: selected, name: name.trim(), canonicalKey })
      // A successful createApp redirects; only an error object returns here.
      if (res && res.ok === false) toast.error(tGeneratedValue(res.error))
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedValue value="Choose a starting point" />
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <GeneratedValue value="Pick the closest structure. You can change every field and workflow in the designer." />
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <GeneratedValue
          value={TYPES.map((t) => {
            const Icon = t.icon
            const isSel = !canonicalKey && t.kind === selected
            return (
              <button
                key={t.kind}
                type="button"
                onClick={() => {
                  setSelected(t.kind)
                  setCanonicalKey(null)
                }}
                className={`group flex flex-col rounded-xl border p-4 text-left transition ${
                  isSel
                    ? 'border-teal-500 bg-white shadow-md ring-1 ring-teal-500'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <span
                  className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${t.accent}`}
                >
                  <Icon size={20} />
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  <GeneratedValue value={t.title} />
                </span>
                <span className="mt-1 text-xs leading-snug text-slate-500">
                  <GeneratedValue value={t.blurb} />
                </span>
              </button>
            )
          })}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedValue value="Ready-made starting points" />
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <GeneratedValue
            value={CANONICAL_TEMPLATES.map((template) => {
              const isSelected = canonicalKey === template.key
              return (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => {
                    setSelected('form')
                    setCanonicalKey(template.key)
                    setName(template.name)
                  }}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-teal-500 bg-white ring-1 ring-teal-500 dark:bg-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                    <Sparkles size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={template.name} />
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedValue value={template.description} />
                    </span>
                  </span>
                </button>
              )
            })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="app-name">
            <GeneratedValue value="App name" />
          </Label>
          <Input
            id="app-name"
            value={name}
            autoComplete="off"
            placeholder={tGeneratedValue(
              selected === 'register'
                ? tGenerated('m_160002942dd7b5')
                : selected === 'checklist'
                  ? tGenerated('m_10289a4ae8ee7f')
                  : selected === 'wizard'
                    ? tGenerated('m_0dda6c57fbf0a4')
                    : tGenerated('m_197712d6d9e6e1'),
            )}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
            }}
          />
        </div>
        <Button onClick={create} disabled={pending} className="shrink-0">
          <GeneratedValue
            value={pending ? <GeneratedText id="m_14edc14616e78d" /> : 'Create app'}
          />
          {!pending ? <ArrowRight size={15} /> : null}
        </Button>
      </div>
    </div>
  )
}
