'use client'

// Drawers for the hazard-library list page:
//   • new-hazard   → create a new hazard library entry
//   • edit-hazard  → edit an existing hazard (id taken from ?id=…)

import { useRouter } from 'next/navigation'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

type FormAction = (formData: FormData) => Promise<void>

type HazardTypeOption = { id: string; name: string }

export type EditHazardDefaults = {
  id: string
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}

export function HazardLibraryDrawers({
  openDrawer,
  closeHref,
  types,
  createAction,
  updateAction,
  deleteAction,
  editDefaults,
}: {
  openDrawer: 'new-hazard' | 'edit-hazard' | null
  closeHref: string
  types: HazardTypeOption[]
  createAction: FormAction
  updateAction: FormAction
  deleteAction: FormAction
  editDefaults: EditHazardDefaults | null
}) {
  return (
    <>
      <NewHazardDrawer
        open={openDrawer === 'new-hazard'}
        closeHref={closeHref}
        types={types}
        action={createAction}
      />
      <EditHazardDrawer
        open={openDrawer === 'edit-hazard' && !!editDefaults}
        closeHref={closeHref}
        types={types}
        defaults={editDefaults}
        updateAction={updateAction}
        deleteAction={deleteAction}
      />
    </>
  )
}

function NewHazardDrawer({
  open,
  closeHref,
  types,
  action,
}: {
  open: boolean
  closeHref: string
  types: HazardTypeOption[]
  action: FormAction
}) {
  const router = useRouter()
  const formId = 'new-hazard-form'

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New hazard"
      description="Add a hazard to the library so crews can pull it into a job-specific assessment."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            Create hazard
          </Button>
        </div>
      }
    >
      <form key={open ? 'new-hazard-open' : 'new-hazard-closed'} id={formId} action={action}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hazard-name">Name *</Label>
            <Input id="hazard-name" name="name" required placeholder="e.g. Pinch point" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-type">Type</Label>
            <Select id="hazard-type" name="hazardTypeId" defaultValue="">
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-description">Description</Label>
            <Textarea id="hazard-description" name="description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-controls">Standard controls (canonical wording)</Label>
            <Textarea
              id="hazard-controls"
              name="standardControls"
              rows={4}
              placeholder="What is the default mitigation?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-risks">Risks (what could go wrong)</Label>
            <Textarea id="hazard-risks" name="risks" rows={2} />
          </div>
        </div>
      </form>
    </UrlDrawer>
  )
}

function EditHazardDrawer({
  open,
  closeHref,
  types,
  defaults,
  updateAction,
  deleteAction,
}: {
  open: boolean
  closeHref: string
  types: HazardTypeOption[]
  defaults: EditHazardDefaults | null
  updateAction: FormAction
  deleteAction: FormAction
}) {
  const router = useRouter()
  const formId = 'edit-hazard-form'

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Edit hazard"
      description="Update the library entry. Changes affect future assessments only."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!defaults}>
            Save
          </Button>
        </div>
      }
    >
      {defaults ? (
        <div className="space-y-6">
          <form
            key={`${defaults.id}-${open ? 'open' : 'closed'}`}
            id={formId}
            action={updateAction}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={defaults.id} />
            <div className="space-y-1.5">
              <Label htmlFor="edit-hazard-name">Name *</Label>
              <Input id="edit-hazard-name" name="name" defaultValue={defaults.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-hazard-type">Type</Label>
              <Select
                id="edit-hazard-type"
                name="hazardTypeId"
                defaultValue={defaults.hazardTypeId ?? ''}
              >
                <option value="">—</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-hazard-description">Description</Label>
              <Textarea
                id="edit-hazard-description"
                name="description"
                rows={2}
                defaultValue={defaults.description ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-hazard-controls">Standard controls</Label>
              <Textarea
                id="edit-hazard-controls"
                name="standardControls"
                rows={4}
                defaultValue={defaults.standardControls ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-hazard-risks">Risks</Label>
              <Textarea
                id="edit-hazard-risks"
                name="risks"
                rows={2}
                defaultValue={defaults.risks ?? ''}
              />
            </div>
          </form>
          <div className="rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-950 dark:bg-red-950/20">
            <div className="mb-3 text-sm font-semibold text-red-700 dark:text-red-300">
              Danger zone
            </div>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={defaults.id} />
              <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                Delete hazard
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </UrlDrawer>
  )
}
