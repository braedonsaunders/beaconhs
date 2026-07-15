'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_06403bdc5b1377') : tGenerated('m_004c17e147bf7e'),
      )}
      description={tGenerated('m_05ffdeb27ae0ca')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(closeHref)}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="submit" form={formId} disabled={mode === 'edit' && !defaults}>
            <GeneratedValue
              value={
                mode === 'create' ? (
                  <GeneratedText id="m_043fe9fe859dff" />
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
                    placeholder={tGenerated('m_1357560d1da2c4')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-color`}>
                    <GeneratedText id="m_0a2f5a489b59e4" />
                  </Label>
                  <Input
                    id={`${formId}-color`}
                    name="color"
                    type="color"
                    defaultValue={defaults?.color ?? '#64748b'}
                    className="h-10 w-20 p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-icon`}>
                    <GeneratedText id="m_1d2300d5f42c1b" />
                  </Label>
                  <Input
                    id={`${formId}-icon`}
                    name="iconKey"
                    defaultValue={defaults?.iconKey ?? ''}
                    placeholder={tGenerated('m_1fa97f94324a91')}
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
                          <GeneratedText id="m_12fda1066d2e96" />
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
