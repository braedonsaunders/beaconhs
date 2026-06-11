'use client'

// The primary "what do you want to build?" picker on the New App page. Choosing
// a type seeds a kind-specific starter schema (server-side) and drops the user
// into the designer already shaped for that type.

import { useState, useTransition } from 'react'
import {
  ArrowRight,
  Blocks,
  FileText,
  ListChecks,
  Table2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { Button, Input, Label } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { createApp, type AppKind } from './_actions'

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
  const [selected, setSelected] = useState<AppKind>('form')
  const [name, setName] = useState('')
  const [pending, start] = useTransition()

  const active = TYPES.find((t) => t.kind === selected)!

  const create = () => {
    if (name.trim().length < 2) {
      toast.error('Give your app a name first')
      return
    }
    start(async () => {
      const res = await createApp({ kind: selected, name: name.trim() })
      // A successful createApp redirects; only an error object returns here.
      if (res && res.ok === false) toast.error(res.error)
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {TYPES.map((t) => {
          const Icon = t.icon
          const isSel = t.kind === selected
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setSelected(t.kind)}
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
              <span className="text-sm font-semibold text-slate-900">{t.title}</span>
              <span className="mt-1 text-xs leading-snug text-slate-500">{t.blurb}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="app-name">Name your {active.title.toLowerCase()}</Label>
          <Input
            id="app-name"
            value={name}
            autoComplete="off"
            placeholder={
              selected === 'register'
                ? 'e.g. Visitor sign-in register'
                : selected === 'checklist'
                  ? 'e.g. Daily plant pre-start checklist'
                  : selected === 'wizard'
                    ? 'e.g. Incident report wizard'
                    : 'e.g. Daily site walk'
            }
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
            }}
          />
        </div>
        <Button onClick={create} disabled={pending} className="shrink-0">
          {pending ? (
            'Creating…'
          ) : (
            <>
              Create {active.title} <ArrowRight size={15} />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
