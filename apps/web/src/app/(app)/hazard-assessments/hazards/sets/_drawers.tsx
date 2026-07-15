'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { MultiPicker } from '../../_multipicker'

type FormAction = (formData: FormData) => Promise<void>

type HazardOption = {
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_1eb142b8a54a70') : tGenerated('m_13280828ed9f13'),
      )}
      description={tGenerated('m_05c405a9fdda60')}
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
                  <GeneratedText id="m_090a391ba7eb4c" />
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
                    placeholder={tGenerated('m_08b09cff023fae')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-description`}>
                    <GeneratedText id="m_14d923495cf14c" />
                  </Label>
                  <Textarea
                    id={`${formId}-description`}
                    name="description"
                    rows={2}
                    defaultValue={defaults?.description ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0aed2f17101d3d" />
                  </Label>
                  <MultiPicker
                    name="hazardIds"
                    defaultSelected={defaults?.hazardIds ?? []}
                    options={hazards}
                    placeholder={tGenerated('m_133b4f736e9ffd')}
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
                          <GeneratedText id="m_1739fb469ef0b9" />
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
