'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  cn,
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
  bordered = true,
}: {
  courseId: string
  lessons: EvalLesson[]
  rows: EvalRow[]
  bordered?: boolean
}) {
  const [target, setTarget] = useState<Target | null>(null)

  return (
    <>
      <div
        className={cn(
          'overflow-x-auto bg-white dark:bg-slate-900',
          bordered && 'rounded-lg border border-slate-200 dark:border-slate-800',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <GeneratedText id="m_1bdb8ab23643f7" />
              </TableHead>
              <GeneratedValue
                value={lessons.map((l) => (
                  <TableHead key={l.id}>
                    <GeneratedValue value={l.title} />
                  </TableHead>
                ))}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            <GeneratedValue
              value={rows.map((r) => (
                <TableRow key={r.enrollmentId}>
                  <TableCell>
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={r.personName} />
                    </div>
                    <GeneratedValue
                      value={
                        r.employeeNo ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            #<GeneratedValue value={r.employeeNo} />
                          </div>
                        ) : null
                      }
                    />
                  </TableCell>
                  <GeneratedValue
                    value={lessons.map((l) => {
                      const cell = r.cells[l.id]!
                      return (
                        <TableCell key={l.id}>
                          <div className="flex items-center gap-2">
                            <GeneratedValue
                              value={
                                cell.status === 'completed' ? (
                                  <Badge variant="success">
                                    <Check size={11} className="mr-1" />
                                    <GeneratedValue
                                      value={
                                        cell.evaluatorName ?? (
                                          <GeneratedText id="m_0a76e44454a0a8" />
                                        )
                                      }
                                    />
                                  </Badge>
                                ) : cell.evaluated ? (
                                  <Badge variant="destructive">
                                    <GeneratedText id="m_110139a3b04bad" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_131b7246255b65" />
                                  </Badge>
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setTarget({ row: r, lesson: l, cell })}
                            >
                              <UserCheck size={13} />
                              <GeneratedValue
                                value={
                                  cell.status === 'completed' ? (
                                    <GeneratedText id="m_0e315ebf127b18" />
                                  ) : (
                                    <GeneratedText id="m_00fb9969980d28" />
                                  )
                                }
                              />
                            </Button>
                          </div>
                        </TableCell>
                      )
                    })}
                  />
                </TableRow>
              ))}
            />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      (target?.lesson.criteria ?? []).map((criterion) => [
        criterion.id,
        target?.cell.criteriaResults?.[criterion.id] === true,
      ]),
    ),
  )
  const [notes, setNotes] = useState(target?.cell.notes ?? '')
  const [signature, setSignature] = useState<string | null>(null)

  if (!target) return null
  const { row, lesson, cell } = target
  const readOnly = row.enrollmentStatus !== 'in_progress'
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
          tGeneratedValue(
            pass
              ? res.courseCompleted
                ? tGenerated('m_1b279f33ed3523')
                : tGenerated('m_08cf626b113431')
              : tGenerated('m_1685483b39b859'),
          ),
        )
        onClose()
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tGenerated('m_0a1370850b1e98', { value0: lesson.title })}
      description={tGeneratedValue(row.personName)}
      size="md"
      footer={
        readOnly ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              <GeneratedText id="m_19ab80ae228d44" />
            </Button>
          </div>
        ) : (
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => submit(false)}
              disabled={pending}
            >
              <X size={14} className="text-rose-500" /> <GeneratedText id="m_110139a3b04bad" />
            </Button>
            <Button
              type="button"
              onClick={() => submit(true)}
              disabled={pending || !allCriteriaPassed || !signature}
              title={tGeneratedValue(
                !allCriteriaPassed
                  ? tGenerated('m_03f016091b1c6f')
                  : !signature
                    ? tGenerated('m_0c637605738d45')
                    : undefined,
              )}
            >
              <GeneratedValue
                value={
                  pending ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <Check size={14} />
                  )
                }
              />
              <GeneratedText id="m_10be3a69806f89" />
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-5">
        <GeneratedValue
          value={
            readOnly ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
                <GeneratedText id="m_1c29ca36726ef5" />{' '}
                <GeneratedValue value={row.enrollmentStatus.replace('_', ' ')} />
                <GeneratedText id="m_02f8d5db3df13e" />
              </p>
            ) : cell.status === 'completed' ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <GeneratedText id="m_1684a291bac90e" />
                <GeneratedValue
                  value={
                    cell.evaluatorName ? (
                      <GeneratedText
                        id="m_157b32720c6840"
                        values={{ value0: cell.evaluatorName }}
                      />
                    ) : (
                      ''
                    )
                  }
                />
                <GeneratedValue
                  value={
                    cell.completedAt ? (
                      <GeneratedText
                        id="m_141ebd8dd339f1"
                        values={{ value0: new Date(cell.completedAt).toLocaleDateString() }}
                      />
                    ) : (
                      ''
                    )
                  }
                />
                <GeneratedText id="m_02e80bc99591ae" />
              </p>
            ) : null
          }
        />

        <GeneratedValue
          value={
            lesson.criteria.length > 0 ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_1a1ce62686f0b8" />
                </Label>
                <GeneratedValue
                  value={lesson.criteria.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={results[c.id] === true}
                        disabled={readOnly}
                        onChange={(e) =>
                          setResults((prev) => ({ ...prev, [c.id]: e.currentTarget.checked }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                      />
                      <GeneratedValue value={c.text} />
                    </label>
                  ))}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_19c8aadc1de575" />
              </p>
            )
          }
        />

        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0b8dadcb78cd08" />
          </Label>
          <Textarea
            rows={2}
            value={notes}
            disabled={readOnly}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder={tGenerated('m_055158b8f0ac19')}
          />
        </div>

        <GeneratedValue
          value={
            !readOnly ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_0d66ed8505bf25" />
                </Label>
                <SignaturePad value={signature} onChange={setSignature} height={140} />
              </div>
            ) : null
          }
        />
      </div>
    </Drawer>
  )
}
