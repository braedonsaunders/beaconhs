'use client'

import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { MultiPicker } from '../../_multipicker'

type FormAction = (formData: FormData) => Promise<void>

export type HazardOption = {
  value: string
  label: string
  sublabel?: string
}

export type EditHazardSetDefaults = {
  id: string
  name: string
  description: string | null
  hazardIds: string[]
}

export function HazardSetDrawers({
  openDrawer,
  closeHref,
  hazards,
  createAction,
  updateAction,
  deleteAction,
  editDefaults,
}: {
  openDrawer: 'new-hazard-set' | 'edit-hazard-set' | null
  closeHref: string
  hazards: HazardOption[]
  createAction: FormAction
  updateAction: FormAction
  deleteAction: FormAction
  editDefaults: EditHazardSetDefaults | null
}) {
  return (
    <>
      <HazardSetDrawer
        mode="create"
        open={openDrawer === 'new-hazard-set'}
        closeHref={closeHref}
        hazards={hazards}
        action={createAction}
      />
      <HazardSetDrawer
        mode="edit"
        open={openDrawer === 'edit-hazard-set' && !!editDefaults}
        closeHref={closeHref}
        hazards={hazards}
        action={updateAction}
        deleteAction={deleteAction}
        defaults={editDefaults}
      />
    </>
  )
}

function HazardSetDrawer({
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
  defaults?: EditHazardSetDefaults | null
}) {
  const router = useRouter()
  const formId = mode === 'create' ? 'new-hazard-set-form' : 'edit-hazard-set-form'
  const formKey =
    mode === 'create'
      ? `new-hazard-set-${open ? 'open' : 'closed'}`
      : `${defaults?.id ?? 'missing'}-${open ? 'open' : 'closed'}`

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'New hazard set' : 'Edit hazard set'}
      description="Bundle related hazards so assessment builders can add them together."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={mode === 'edit' && !defaults}>
            {mode === 'create' ? 'Create set' : 'Save'}
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
                placeholder="e.g. Outdoor work hazards"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-description`}>Description</Label>
              <Textarea
                id={`${formId}-description`}
                name="description"
                rows={2}
                defaultValue={defaults?.description ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hazards in set</Label>
              <MultiPicker
                name="hazardIds"
                defaultSelected={defaults?.hazardIds ?? []}
                options={hazards}
                placeholder="Search hazards…"
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
                  Delete set
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </UrlDrawer>
  )
}
