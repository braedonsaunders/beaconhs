import { notFound, redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { LayoutGrid, Plus, Save, Settings2, Trash2 } from 'lucide-react'
import { Badge, Button, DetailHeader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import {
  formTemplates,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
  personGroups,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import {
  addTypeApp,
  addTypePPE,
  addTypeQuestion,
  deleteAssessmentType,
  deleteTypeApp,
  deleteTypePPE,
  deleteTypeQuestion,
  updateAssessmentType,
} from '../../_actions'
import { MultiPicker } from '../../_multipicker'

export const dynamic = 'force-dynamic'

async function remove(formData: FormData) {
  'use server'
  await deleteAssessmentType(formData)
  redirect('/hazard-assessments/types')
}

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
      .where(and(eq(hazidAssessmentTypes.id, id), isNull(hazidAssessmentTypes.deletedAt)))
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
    const sets = await tx
      .select({ id: hazidHazardSets.id, name: hazidHazardSets.name })
      .from(hazidHazardSets)
      .orderBy(asc(hazidHazardSets.name))
    const groups = await tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name))
    return { type, ppe, questions, typeApps, appTemplates, sets, groups }
  })
  if (!data) notFound()
  const { type, ppe, questions, typeApps, appTemplates, sets, groups } = data
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
          />
        </>
      }
      className="h-full max-w-none p-0"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 lg:flex-row dark:bg-slate-950">
        <aside className="flex max-h-[48vh] min-h-0 w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-1/3 lg:max-w-md lg:min-w-[320px] lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
              <Settings2 size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Type settings
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Overview, sections, access
              </div>
            </div>
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <form action={updateAssessmentType} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required defaultValue={type.name} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={3} defaultValue={type.description ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Style</Label>
                <Select name="style" defaultValue={type.style}>
                  <option value="task_based">Task-based</option>
                  <option value="hazard_based">Hazard-based</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default hazard set</Label>
                <Select name="defaultHazardSetId" defaultValue={type.defaultHazardSetId ?? ''}>
                  <option value="">— none —</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <legend className="px-1 text-xs font-medium text-slate-500">
                  Enabled sections
                </legend>
                <Check name="hasTasks" label="Tasks" defaultChecked={type.hasTasks} />
                <Check name="hasHazards" label="Hazards" defaultChecked={type.hasHazards} />
                <Check name="hasPPE" label="PPE" defaultChecked={type.hasPPE} />
                <Check
                  name="hasQuestions"
                  label="Questions & Answers"
                  defaultChecked={type.hasQuestions}
                />
                <Check name="hasWAH" label="Fall Protection" defaultChecked={type.hasWAH} />
              </fieldset>
              {groups.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Available to (person groups)</Label>
                  <p className="text-xs text-slate-500">
                    Leave empty to offer this type to everyone; pick groups to restrict who can
                    start one.
                  </p>
                  <MultiPicker
                    name="availableToGroupIds"
                    defaultSelected={type.availableToGroupIds ?? []}
                    options={groups.map((g) => ({ value: g.id, label: g.name }))}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-end">
                <Button type="submit">
                  <Save size={14} /> Save overview
                </Button>
              </div>
            </form>

            <div className="mt-6 rounded-md border border-red-200 bg-red-50/60 p-3 dark:border-red-950 dark:bg-red-950/20">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
                  Delete assessment type
                </h2>
                <p className="text-sm text-red-700/80 dark:text-red-300/80">
                  Removes this type from the assessment type library.
                </p>
              </div>
              <form action={remove} className="mt-3 flex justify-end">
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                  <Trash2 size={14} /> Delete type
                </Button>
              </form>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <LayoutGrid size={15} />
              Build surface
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Badge variant="secondary">Apps {typeApps.length}</Badge>
              <Badge variant="secondary">PPE {ppe.length}</Badge>
              <Badge variant="secondary">Questions {questions.length}</Badge>
            </div>
          </div>

          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="space-y-4">
              <BuilderPanel
                title={`Builder apps (${typeApps.length})`}
                subtitle="Attach published Builder apps that become embedded assessment sections."
              >
                <div className="space-y-3">
                  <form
                    action={addTypeApp}
                    className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/30"
                  >
                    <input type="hidden" name="typeId" value={id} />
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
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
                      <div className="space-y-1.5 xl:col-span-3">
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
                      <Button type="submit">
                        <Plus size={14} /> Attach app
                      </Button>
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
                              {app.autoCreate ? (
                                <Badge variant="secondary">Auto draft</Badge>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {template.name} · {app.key}
                              {app.description ? ` · ${app.description}` : ''}
                            </div>
                          </div>
                          <form action={deleteTypeApp}>
                            <input type="hidden" name="id" value={app.id} />
                            <input type="hidden" name="typeId" value={id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              className="text-red-600"
                            >
                              <Trash2 size={14} /> Remove
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </BuilderPanel>

              <BuilderPanel
                title={`Default PPE (${ppe.length})`}
                subtitle="Seed PPE rows into new assessments created from this type."
              >
                <div className="space-y-3">
                  <form
                    action={addTypePPE}
                    className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-3 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-800/30"
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
                      <Button type="submit">
                        <Plus size={14} /> Add
                      </Button>
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
                                <span className="ml-2 text-xs text-red-600 uppercase">
                                  required
                                </span>
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
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              className="text-red-600"
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </BuilderPanel>

              <BuilderPanel
                title={`Default questions (${questions.length})`}
                subtitle="Seed required intake and verification questions for this assessment type."
              >
                <div className="space-y-3">
                  <form
                    action={addTypeQuestion}
                    className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/30"
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
                      <Button type="submit">
                        <Plus size={14} /> Add question
                      </Button>
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
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              className="text-red-600"
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </BuilderPanel>
            </div>
          </div>
        </div>
      </div>
    </DetailPageLayout>
  )
}

function BuilderPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
      />
      {label}
    </label>
  )
}
