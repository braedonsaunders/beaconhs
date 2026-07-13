'use client'

// Evaluations grid + sign-off drawer. Each cell is (enrollment × practical
// lesson); evaluators check criteria, add notes, sign, and pass/fail.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, UserCheck, X } from 'lucide-react'
import {
  Badge,
  Button,
  Drawer,
  Label,
  SignaturePad,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import type { PracticalCriterion } from '@beaconhs/db/schema'
import { toast } from '@/lib/toast'
import { evaluatePractical } from './_actions'

export type EvalLesson = { id: string; title: string; criteria: PracticalCriterion[] }
type EvalCell = {
  status: 'not_started' | 'in_progress' | 'completed'
  evaluated: boolean
  evaluatorName: string | null
  completedAt: string | null
  criteriaResults: Record<string, boolean> | null
  notes: string | null
}
export type EvalRow = {
  enrollmentId: string
  personName: string
  employeeNo: string | null
  enrollmentStatus: string
  cells: Record<string, EvalCell>
}

type Target = { row: EvalRow; lesson: EvalLesson; cell: EvalCell }

export function EvaluationsGrid({
  courseId,
  lessons,
  rows,
}: {
  courseId: string
  lessons: EvalLesson[]
  rows: EvalRow[]
}) {
  const [target, setTarget] = useState<Target | null>(null)

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Learner</TableHead>
              {lessons.map((l) => (
                <TableHead key={l.id}>{l.title}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.enrollmentId}>
                <TableCell>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {r.personName}
                  </div>
                  {r.employeeNo ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      #{r.employeeNo}
                    </div>
                  ) : null}
                </TableCell>
                {lessons.map((l) => {
                  const cell = r.cells[l.id]!
                  return (
                    <TableCell key={l.id}>
                      <div className="flex items-center gap-2">
                        {cell.status === 'completed' ? (
                          <Badge variant="success">
                            <Check size={11} className="mr-1" />
                            {cell.evaluatorName ?? 'Signed off'}
                          </Badge>
                        ) : cell.evaluated ? (
                          <Badge variant="destructive">Not yet competent</Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setTarget({ row: r, lesson: l, cell })}
                        >
                          <UserCheck size={13} />
                          {cell.status === 'completed' ? 'Review' : 'Evaluate'}
                        </Button>
                      </div>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EvaluateDrawer
        key={target ? `${target.row.enrollmentId}:${target.lesson.id}` : 'none'}
        courseId={courseId}
        target={target}
        onClose={() => setTarget(null)}
      />
    </>
  )
}

function EvaluateDrawer({
  courseId,
  target,
  onClose,
}: {
  courseId: string
  target: Target | null
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<Record<string, boolean>>(
    target?.cell.criteriaResults ?? {},
  )
  const [notes, setNotes] = useState(target?.cell.notes ?? '')
  const [signature, setSignature] = useState<string | null>(null)

  if (!target) return null
  const { row, lesson, cell } = target
  const allCriteriaPassed =
    lesson.criteria.length === 0 || lesson.criteria.every((c) => results[c.id] === true)

  function submit(pass: boolean) {
    startTransition(async () => {
      const res = await evaluatePractical({
        courseId,
        enrollmentId: row.enrollmentId,
        lessonId: lesson.id,
        pass,
        criteriaResults: results,
        notes: notes.trim() || null,
        signatureDataUrl: signature,
      })
      if (res.ok) {
        toast.success(
          pass
            ? res.courseCompleted
              ? 'Signed off — course completed, record & certificate issued'
              : 'Signed off as competent'
            : 'Recorded as not yet competent',
        )
        onClose()
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Evaluate · ${lesson.title}`}
      description={row.personName}
      size="md"
      footer={
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => submit(false)} disabled={pending}>
            <X size={14} className="text-rose-500" /> Not yet competent
          </Button>
          <Button
            type="button"
            onClick={() => submit(true)}
            disabled={pending || !allCriteriaPassed || !signature}
            title={
              !allCriteriaPassed
                ? 'Check every criterion to sign off'
                : !signature
                  ? 'Sign to confirm'
                  : undefined
            }
          >
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Check size={14} />}
            Sign off — competent
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {cell.status === 'completed' ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            Already signed off{cell.evaluatorName ? ` by ${cell.evaluatorName}` : ''}
            {cell.completedAt ? ` on ${new Date(cell.completedAt).toLocaleDateString()}` : ''}.
            Re-submitting replaces the evaluation.
          </p>
        ) : null}

        {lesson.criteria.length > 0 ? (
          <div className="space-y-1.5">
            <Label>Criteria</Label>
            {lesson.criteria.map((c) => (
              <label
                key={c.id}
                className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={results[c.id] === true}
                  onChange={(e) =>
                    setResults((prev) => ({ ...prev, [c.id]: e.currentTarget.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                />
                {c.text}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This practical has no itemised criteria — sign off based on your observation.
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Observations, conditions, equipment used…"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Evaluator signature</Label>
          <SignaturePad value={signature} onChange={setSignature} height={140} />
        </div>
      </div>
    </Drawer>
  )
}
