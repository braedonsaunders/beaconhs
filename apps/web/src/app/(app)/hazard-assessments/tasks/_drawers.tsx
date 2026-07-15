'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useRouter } from 'next/navigation'
import { normalizeDocumentHref } from '@beaconhs/forms-core'
import { Button, Input, Label, RichTextEditor, Textarea, UrlDrawer } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { MultiPicker } from '../_multipicker'
import { RiskMatrixField } from '../_risk'

type FormAction = (formData: FormData) => Promise<void>

type HazardOption = {
  value: string
  label: string
  sublabel?: string
}

export type EditTaskDefaults = {
  id: string
  name: string
  description: string | null
  controls: string | null
  hazardIds: string[]
  preLikelihood: number | null
  preSeverity: number | null
  postLikelihood: number | null
  postSeverity: number | null
}

export function TaskLibraryDrawers({
  openDrawer,
  closeHref,
  hazards,
  createAction,
  updateAction,
  deleteAction,
  editDefaults,
}: {
  openDrawer: 'new-task' | 'edit-task' | null
  closeHref: string
  hazards: HazardOption[]
  createAction: FormAction
  updateAction: FormAction
  deleteAction: FormAction
  editDefaults: EditTaskDefaults | null
}) {
  return (
    <>
      <TaskDrawer
        mode="create"
        open={openDrawer === 'new-task'}
        closeHref={closeHref}
        hazards={hazards}
        action={createAction}
      />
      <TaskDrawer
        mode="edit"
        open={openDrawer === 'edit-task' && !!editDefaults}
        closeHref={closeHref}
        hazards={hazards}
        action={updateAction}
        deleteAction={deleteAction}
        defaults={editDefaults}
      />
    </>
  )
}

function TaskDrawer({
  mode,
  open,
  closeHref,
  hazards,
  action,
  deleteAction,
  defaults,
}: {
  mode: 'create' | 'edit'
  open: boolean
  closeHref: string
  hazards: HazardOption[]
  action: FormAction
  deleteAction?: FormAction
  defaults?: EditTaskDefaults | null
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const formId = mode === 'create' ? 'new-task-form' : 'edit-task-form'
  const formKey =
    mode === 'create'
      ? `new-task-${open ? 'open' : 'closed'}`
      : `${defaults?.id ?? 'missing'}-${open ? 'open' : 'closed'}`

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_0ce13fcbf98954') : tGenerated('m_106407c29478a2'),
      )}
      description={tGenerated('m_004b51a9c7971c')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="submit" form={formId} disabled={mode === 'edit' && !defaults}>
            <GeneratedValue
              value={
                mode === 'create' ? (
                  <GeneratedText id="m_1ee2e410aee9d8" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <GeneratedValue
        value={
          mode === 'create' || defaults ? (
            <div className="space-y-6">
              <form key={formKey} id={formId} action={action} className="space-y-4">
                <GeneratedValue
                  value={defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-name`}>
                    <GeneratedText id="m_1a9978900838e6" />
                  </Label>
                  <Input
                    id={`${formId}-name`}
                    name="name"
                    defaultValue={defaults?.name ?? ''}
                    required
                    placeholder={tGenerated('m_149f6045d49bda')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-description`}>
                    <GeneratedText id="m_14d923495cf14c" />
                  </Label>
                  <Textarea
                    id={`${formId}-description`}
                    name="description"
                    rows={3}
                    defaultValue={defaults?.description ?? ''}
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                  <RiskMatrixField
                    label={tGenerated('m_0c1f42d1f7e103')}
                    likelihoodName="preLikelihood"
                    severityName="preSeverity"
                    defaultLikelihood={defaults?.preLikelihood ?? null}
                    defaultSeverity={defaults?.preSeverity ?? null}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0e1defb9956b5b" />
                  </Label>
                  <RichTextEditor
                    name="controls"
                    defaultValue={defaults?.controls ?? ''}
                    placeholder={tGenerated('m_01db6b3cd0125e')}
                    minHeight="140px"
                    normalizeLink={normalizeDocumentHref}
                    onInvalidLink={() => toast.error(tGenerated('m_19dc719a9038ec'))}
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                  <RiskMatrixField
                    label={tGenerated('m_0271f7a4e1fc28')}
                    likelihoodName="postLikelihood"
                    severityName="postSeverity"
                    defaultLikelihood={defaults?.postLikelihood ?? null}
                    defaultSeverity={defaults?.postSeverity ?? null}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0d68207e1f7148" />
                  </Label>
                  <MultiPicker
                    name="hazardIds"
                    defaultSelected={defaults?.hazardIds ?? []}
                    options={hazards}
                  />
                </div>
              </form>
              <GeneratedValue
                value={
                  mode === 'edit' && defaults && deleteAction ? (
                    <div className="rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-950 dark:bg-red-950/20">
                      <div className="mb-3 text-sm font-semibold text-red-700 dark:text-red-300">
                        <GeneratedText id="m_024e9c1e0bab8f" />
                      </div>
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={defaults.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          className="text-red-600 hover:bg-red-50"
                        >
                          <GeneratedText id="m_0605617ba72676" />
                        </Button>
                      </form>
                    </div>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />
    </UrlDrawer>
  )
}
