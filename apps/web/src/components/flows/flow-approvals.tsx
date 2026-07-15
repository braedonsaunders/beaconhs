'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Flow approvals — pending human gates from the automation canvas, for ANY
// subject (a form response, a journal, a hazard assessment, …). The assignee (or
// a manager for that subject) approves/rejects; resolving resumes the flow branch
// server-side. Mount on any record's detail page with its subjectType+subjectId.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShieldCheck, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { resolveFlowGate } from '@/lib/flows/gate-actions'
import type { PendingFlowGate } from '@/lib/flows/gate-store'

export function FlowApprovals({ gates }: { gates: PendingFlowGate[] }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (gates.length === 0) return null

  const act = (gateId: string, decision: 'approve' | 'reject') => {
    setBusyId(gateId)
    start(async () => {
      const res = await resolveFlowGate({ gateId, decision })
      setBusyId(null)
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error))
        return
      }
      toast.success(
        tGeneratedValue(
          decision === 'approve' ? tGenerated('m_1d8e20d8b5d488') : tGenerated('m_1870217cd63ffc'),
        ),
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          <GeneratedText id="m_0ba7b8aa4eb275" />
        </h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-200">
          <GeneratedValue value={gates.length} /> <GeneratedText id="m_15ac663b8c57a6" />
        </span>
      </div>
      <ul className="space-y-2">
        <GeneratedValue
          value={gates.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  <GeneratedValue value={g.title} />
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue
                    value={
                      g.assigneeName ? (
                        <GeneratedText id="m_13eb51e6f567ab" values={{ value0: g.assigneeName }} />
                      ) : (
                        <GeneratedText id="m_10d1d0d92a9aaa" />
                      )
                    }
                  />
                  <GeneratedValue
                    value={g.assignedToMe ? <GeneratedText id="m_15003cf50946e2" /> : ''}
                  />
                </p>
              </div>
              <GeneratedValue
                value={
                  g.canAct ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending && busyId === g.id}
                        onClick={() => act(g.id, 'reject')}
                      >
                        <X size={14} className="text-rose-500" />{' '}
                        <GeneratedText id="m_0f51548c04b27f" />
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending && busyId === g.id}
                        onClick={() => act(g.id, 'approve')}
                      >
                        <Check size={14} /> <GeneratedText id="m_05194a49d7f46e" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">
                      <GeneratedText id="m_0c0a5e965faf5c" />
                    </span>
                  )
                }
              />
            </li>
          ))}
        />
      </ul>
    </section>
  )
}
