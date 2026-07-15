'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const formId = 'new-hazard-form'

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_164d4e8b6e12d6')}
      description={tGenerated('m_051bd26c677ddf')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="submit" form={formId}>
            <GeneratedText id="m_120a2a76f7cdab" />
          </Button>
        </div>
      }
    >
      <form key={open ? 'new-hazard-open' : 'new-hazard-closed'} id={formId} action={action}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hazard-name">
              <GeneratedText id="m_1a9978900838e6" />
            </Label>
            <Input
              id="hazard-name"
              name="name"
              required
              placeholder={tGenerated('m_1874f495d94439')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-type">
              <GeneratedText id="m_074ba2f160c506" />
            </Label>
            <Select id="hazard-type" name="hazardTypeId" defaultValue="">
              <option value="">—</option>
              <GeneratedValue
                value={types.map((t) => (
                  <option key={t.id} value={t.id}>
                    <GeneratedValue value={t.name} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-description">
              <GeneratedText id="m_14d923495cf14c" />
            </Label>
            <Textarea id="hazard-description" name="description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-controls">
              <GeneratedText id="m_1457d11c2dc312" />
            </Label>
            <Textarea
              id="hazard-controls"
              name="standardControls"
              rows={4}
              placeholder={tGenerated('m_0056d7b72d2f84')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hazard-risks">
              <GeneratedText id="m_0952d27c8c73c1" />
            </Label>
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
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const formId = 'edit-hazard-form'

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_1e7cc4ca81f651')}
      description={tGenerated('m_14b03e8f4a926f')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="submit" form={formId} disabled={!defaults}>
            <GeneratedText id="m_19e6bff894c3c7" />
          </Button>
        </div>
      }
    >
      <GeneratedValue
        value={
          defaults ? (
            <div className="space-y-6">
              <form
                key={`${defaults.id}-${open ? 'open' : 'closed'}`}
                id={formId}
                action={updateAction}
                className="space-y-4"
              >
                <input type="hidden" name="id" value={defaults.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hazard-name">
                    <GeneratedText id="m_1a9978900838e6" />
                  </Label>
                  <Input id="edit-hazard-name" name="name" defaultValue={defaults.name} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hazard-type">
                    <GeneratedText id="m_074ba2f160c506" />
                  </Label>
                  <Select
                    id="edit-hazard-type"
                    name="hazardTypeId"
                    defaultValue={defaults.hazardTypeId ?? ''}
                  >
                    <option value="">—</option>
                    <GeneratedValue
                      value={types.map((t) => (
                        <option key={t.id} value={t.id}>
                          <GeneratedValue value={t.name} />
                        </option>
                      ))}
                    />
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hazard-description">
                    <GeneratedText id="m_14d923495cf14c" />
                  </Label>
                  <Textarea
                    id="edit-hazard-description"
                    name="description"
                    rows={2}
                    defaultValue={defaults.description ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hazard-controls">
                    <GeneratedText id="m_065d22244967d3" />
                  </Label>
                  <Textarea
                    id="edit-hazard-controls"
                    name="standardControls"
                    rows={4}
                    defaultValue={defaults.standardControls ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hazard-risks">
                    <GeneratedText id="m_176b29641dba72" />
                  </Label>
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
                  <GeneratedText id="m_024e9c1e0bab8f" />
                </div>
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={defaults.id} />
                  <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                    <GeneratedText id="m_0838edf0917d23" />
                  </Button>
                </form>
              </div>
            </div>
          ) : null
        }
      />
    </UrlDrawer>
  )
}
