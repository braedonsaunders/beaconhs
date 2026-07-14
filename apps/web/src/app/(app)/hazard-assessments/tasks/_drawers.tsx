'use client'

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
      title={mode === 'create' ? 'New task' : 'Edit task'}
      description="Configure a reusable task template with default hazards, controls, and risk ratings."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={mode === 'edit' && !defaults}>
            {mode === 'create' ? 'Create task' : 'Save'}
          </Button>
        </div>
      }
    >
      {mode === 'create' || defaults ? (
        <div className="space-y-6">
          <form key={formKey} id={formId} action={action} className="space-y-4">
            {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-name`}>Name *</Label>
              <Input
                id={`${formId}-name`}
                name="name"
                defaultValue={defaults?.name ?? ''}
                required
                placeholder="e.g. Open / break flanges on live line"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-description`}>Description</Label>
              <Textarea
                id={`${formId}-description`}
                name="description"
                rows={3}
                defaultValue={defaults?.description ?? ''}
              />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <RiskMatrixField
                label="Inherent risk (before controls)"
                likelihoodName="preLikelihood"
                severityName="preSeverity"
                defaultLikelihood={defaults?.preLikelihood ?? null}
                defaultSeverity={defaults?.preSeverity ?? null}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default controls</Label>
              <RichTextEditor
                name="controls"
                defaultValue={defaults?.controls ?? ''}
                placeholder="LOTO, double-block & bleed, PPE..."
                minHeight="140px"
                normalizeLink={normalizeDocumentHref}
                onInvalidLink={() =>
                  toast.error('Use an HTTPS, email, phone, /path, or #anchor link.')
                }
              />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <RiskMatrixField
                label="Residual risk (with controls in place)"
                likelihoodName="postLikelihood"
                severityName="postSeverity"
                defaultLikelihood={defaults?.postLikelihood ?? null}
                defaultSeverity={defaults?.postSeverity ?? null}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Linked hazards</Label>
              <MultiPicker
                name="hazardIds"
                defaultSelected={defaults?.hazardIds ?? []}
                options={hazards}
              />
            </div>
          </form>
          {mode === 'edit' && defaults && deleteAction ? (
            <div className="rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-950 dark:bg-red-950/20">
              <div className="mb-3 text-sm font-semibold text-red-700 dark:text-red-300">
                Danger zone
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={defaults.id} />
                <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                  Delete task
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </UrlDrawer>
  )
}
