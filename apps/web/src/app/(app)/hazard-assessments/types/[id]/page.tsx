import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Badge, Button, DetailHeader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import {
  formTemplates,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import {
  addTypeApp,
  addTypePPE,
  addTypeQuestion,
  deleteTypeApp,
  deleteTypePPE,
  deleteTypeQuestion,
} from '../../_actions'

export const dynamic = 'force-dynamic'

export default async function AssessmentTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('hazid')
  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(hazidAssessmentTypes)
      .where(eq(hazidAssessmentTypes.id, id))
      .limit(1)
    if (!type) return null
    const ppe = await tx
      .select()
      .from(hazidAssessmentTypePPE)
      .where(eq(hazidAssessmentTypePPE.typeId, id))
      .orderBy(asc(hazidAssessmentTypePPE.entityOrder))
    const questions = await tx
      .select()
      .from(hazidAssessmentTypeQuestions)
      .where(eq(hazidAssessmentTypeQuestions.typeId, id))
      .orderBy(asc(hazidAssessmentTypeQuestions.entityOrder))
    const typeApps = await tx
      .select({ app: hazidAssessmentTypeApps, template: formTemplates })
      .from(hazidAssessmentTypeApps)
      .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
      .where(eq(hazidAssessmentTypeApps.typeId, id))
      .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
    const appTemplates = await tx
      .select({ id: formTemplates.id, name: formTemplates.name, kind: formTemplates.kind })
      .from(formTemplates)
      .where(and(eq(formTemplates.status, 'published'), isNull(formTemplates.deletedAt)))
      .orderBy(asc(formTemplates.name))
    let defaultSet: { name: string } | null = null
    if (type.defaultHazardSetId) {
      const [s] = await tx
        .select({ name: hazidHazardSets.name })
        .from(hazidHazardSets)
        .where(eq(hazidHazardSets.id, type.defaultHazardSetId))
        .limit(1)
      defaultSet = s ?? null
    }
    return { type, ppe, questions, typeApps, appTemplates, defaultSet }
  })
  if (!data) notFound()
  const { type, ppe, questions, typeApps, appTemplates, defaultSet } = data
  return (
    <DetailPageLayout
      header={
        <>
          <div className="mb-2"></div>
          <DetailHeader
            back={{ href: '/hazard-assessments/types', label: 'Back' }}
            title={type.name}
            badge={
              <div className="flex flex-wrap items-center gap-1">
                {type.hasPPE ? <Badge variant="secondary">PPE</Badge> : null}
                {type.hasQuestions ? <Badge variant="secondary">Q&amp;A</Badge> : null}
                {type.hasTasks ? <Badge variant="secondary">Tasks</Badge> : null}
                {type.hasHazards ? <Badge variant="secondary">Hazards</Badge> : null}
                {type.hasWAH ? <Badge variant="outline">WAH</Badge> : null}
              </div>
            }
            actions={
              <Link href={`/hazard-assessments/types/${id}/edit`}>
                <Button variant="outline">Edit</Button>
              </Link>
            }
          />
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Overview" defaultOpen>
          <DetailGrid
            rows={[
              { label: 'Name', value: type.name },
              { label: 'Style', value: type.style.replace('_', '-') },
              { label: 'Description', value: type.description ?? '—' },
              { label: 'Default hazard set', value: defaultSet?.name ?? '—' },
            ]}
          />
        </Section>

        <Section title={`Builder apps (${typeApps.length})`} defaultOpen>
          <div className="space-y-3">
            <form
              action={addTypeApp}
              className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 dark:border-slate-700 dark:bg-slate-800/30"
            >
              <input type="hidden" name="typeId" value={id} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Published app</Label>
                  <Select name="templateId" required defaultValue="">
                    <option value="" disabled>
                      Select an app…
                    </option>
                    {appTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input name="label" placeholder="Defaults to app name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Key</Label>
                  <Input name="key" placeholder="e.g. confined_space" />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Description</Label>
                  <Input name="description" placeholder="Shown on the assessment app card" />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="required" />
                  Required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoCreate" defaultChecked />
                  Create draft on new assessments
                </label>
                <Button type="submit">Attach app</Button>
              </div>
            </form>
            {typeApps.length === 0 ? (
              <p className="text-sm text-slate-500">No builder apps attached.</p>
            ) : (
              <ul className="space-y-2">
                {typeApps.map(({ app, template }) => (
                  <li
                    key={app.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto] dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        <span>{app.label}</span>
                        {app.required ? <Badge variant="outline">Required</Badge> : null}
                        {app.autoCreate ? <Badge variant="secondary">Auto draft</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {template.name} · {app.key}
                        {app.description ? ` · ${app.description}` : ''}
                      </div>
                    </div>
                    <form action={deleteTypeApp}>
                      <input type="hidden" name="id" value={app.id} />
                      <input type="hidden" name="typeId" value={id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-red-600">
                        Remove
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title={`Default PPE (${ppe.length})`} defaultOpen>
          <div className="space-y-3">
            <form
              action={addTypePPE}
              className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-800/30"
            >
              <input type="hidden" name="typeId" value={id} />
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input name="name" required placeholder="e.g. Hard hat" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Input name="description" placeholder="When / why" />
              </div>
              <div className="flex items-center justify-end gap-2 sm:col-span-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="required" defaultChecked />
                  Required
                </label>
                <Button type="submit">Add</Button>
              </div>
            </form>
            {ppe.length === 0 ? (
              <p className="text-sm text-slate-500">No default PPE rows.</p>
            ) : (
              <ul className="space-y-2">
                {ppe.map((row) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto_auto] dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.name}
                        {row.required ? (
                          <span className="ml-2 text-xs text-red-600 uppercase">required</span>
                        ) : null}
                      </div>
                      {row.description ? (
                        <div className="text-xs text-slate-500">{row.description}</div>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-500">#{row.entityOrder}</span>
                    <form action={deleteTypePPE}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="typeId" value={id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-red-600">
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title={`Default questions (${questions.length})`} defaultOpen>
          <div className="space-y-3">
            <form
              action={addTypeQuestion}
              className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 dark:border-slate-700 dark:bg-slate-800/30"
            >
              <input type="hidden" name="typeId" value={id} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Question</Label>
                  <Input name="question" required placeholder="Are permits posted?" />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select name="questionType" defaultValue="yes_no">
                    <option value="yes_no">Yes/No</option>
                    <option value="text">Free text</option>
                    <option value="multi_select">Multi-select</option>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Multi-select options (one per line; ignored for other types)</Label>
                  <Textarea name="answers" rows={2} />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-3">
                  <input type="checkbox" name="requiresYes" />
                  Requires "Yes" for completion
                </label>
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Add question</Button>
              </div>
            </form>
            {questions.length === 0 ? (
              <p className="text-sm text-slate-500">No default questions.</p>
            ) : (
              <ul className="space-y-2">
                {questions.map((q) => (
                  <li
                    key={q.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto] dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {q.question}
                      </div>
                      <div className="text-xs text-slate-500">
                        {q.questionType.replace('_', ' ')}
                        {q.requiresYes ? ' · requires Yes' : ''}
                        {q.answers.length > 0 ? ` · ${q.answers.join(', ')}` : ''}
                      </div>
                    </div>
                    <form action={deleteTypeQuestion}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="typeId" value={id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-red-600">
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>
    </DetailPageLayout>
  )
}
