'use client'

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
        toast.error(res.error)
        return
      }
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected')
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Flow approvals</h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-200">
          {gates.length} pending
        </span>
      </div>
      <ul className="space-y-2">
        {gates.map((g) => (
          <li
            key={g.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                {g.title}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {g.assigneeName ? `Assigned to ${g.assigneeName}` : 'Unassigned'}
                {g.assignedToMe ? ' · you' : ''}
              </p>
            </div>
            {g.canAct ? (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending && busyId === g.id}
                  onClick={() => act(g.id, 'reject')}
                >
                  <X size={14} className="text-rose-500" /> Reject
                </Button>
                <Button
                  size="sm"
                  disabled={pending && busyId === g.id}
                  onClick={() => act(g.id, 'approve')}
                >
                  <Check size={14} /> Approve
                </Button>
              </div>
            ) : (
              <span className="text-xs text-slate-400">Awaiting approver</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
