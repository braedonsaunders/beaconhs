'use client'

import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'

type FormAction = (formData: FormData) => Promise<void>

export type EditHazardTypeDefaults = {
  id: string
  name: string
  color: string
  iconKey: string | null
  description: string | null
}

export function HazardTypeDrawers({
  openDrawer,
  closeHref,
  createAction,
  updateAction,
  deleteAction,
  editDefaults,
}: {
  openDrawer: 'new-hazard-type' | 'edit-hazard-type' | null
  closeHref: string
  createAction: FormAction
  updateAction: FormAction
  deleteAction: FormAction
  editDefaults: EditHazardTypeDefaults | null
}) {
  return (
    <>
      <HazardTypeDrawer
        mode="create"
        open={openDrawer === 'new-hazard-type'}
        closeHref={closeHref}
        action={createAction}
      />
      <HazardTypeDrawer
        mode="edit"
        open={openDrawer === 'edit-hazard-type' && !!editDefaults}
        closeHref={closeHref}
        action={updateAction}
        deleteAction={deleteAction}
        defaults={editDefaults}
      />
    </>
  )
}

function HazardTypeDrawer({
  mode,
  open,
  closeHref,
  action,
  deleteAction,
  defaults,
}: {
  mode: 'create' | 'edit'
  open: boolean
  closeHref: string
  action: FormAction
  deleteAction?: FormAction
  defaults?: EditHazardTypeDefaults | null
}) {
  const router = useRouter()
  const formId = mode === 'create' ? 'new-hazard-type-form' : 'edit-hazard-type-form'
  const formKey =
    mode === 'create'
      ? `new-hazard-type-${open ? 'open' : 'closed'}`
      : `${defaults?.id ?? 'missing'}-${open ? 'open' : 'closed'}`

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'New hazard type' : 'Edit hazard type'}
      description="Maintain the taxonomy and color used to organize hazards in assessments."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={mode === 'edit' && !defaults}>
            {mode === 'create' ? 'Create type' : 'Save'}
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
                placeholder="e.g. Mechanical"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-color`}>Color</Label>
              <Input
                id={`${formId}-color`}
                name="color"
                type="color"
                defaultValue={defaults?.color ?? '#64748b'}
                className="h-10 w-20 p-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-icon`}>Icon key (Lucide)</Label>
              <Input
                id={`${formId}-icon`}
                name="iconKey"
                defaultValue={defaults?.iconKey ?? ''}
                placeholder="e.g. zap, flame, hammer"
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
          </form>
          {mode === 'edit' && defaults && deleteAction ? (
            <div className="rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-950 dark:bg-red-950/20">
              <div className="mb-3 text-sm font-semibold text-red-700 dark:text-red-300">
                Danger zone
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={defaults.id} />
                <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                  Delete type
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </UrlDrawer>
  )
}
