import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { eq } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { correctiveActionSeverity, correctiveActionSource, incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { RemoteSelectField } from '@/components/remote-search-select'
import { createCorrectiveAction } from './_actions'

/**
 * Body of the "New corrective action" UrlDrawer on the list page. A source
 * preset (e.g. from an incident) renders a read-only banner and rides along
 * as hidden fields; the server action re-validates it before linking.
 */
export async function NewCorrectiveActionDrawer({
  presetSourceType,
  presetSourceId,
}: {
  presetSourceType?: string | null
  presetSourceId?: string | null
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const membershipId =
    ctx.membership?.id && ctx.membership.id !== 'super-admin' ? ctx.membership.id : ''

  const sourceIncident = await ctx.db(async (tx) => {
    if (presetSourceType !== 'incident' || !presetSourceId || !isUuid(presetSourceId)) return null
    const [i] = await tx
      .select({ reference: incidents.reference, title: incidents.title })
      .from(incidents)
      .where(eq(incidents.id, presetSourceId))
      .limit(1)
    return i ?? null
  })

  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          sourceIncident ? (
            <Alert variant="info">
              <AlertTitle>
                <GeneratedText id="m_0bbef5a046ab0a" />
              </AlertTitle>
              <AlertDescription>
                <GeneratedValue value={sourceIncident.reference} /> ·{' '}
                <GeneratedValue value={sourceIncident.title} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />
      <form action={createCorrectiveAction} className="space-y-4">
        <input type="hidden" name="sourceEntityId" value={presetSourceId ?? ''} />
        <input type="hidden" name="sourceEntityType" value={presetSourceType ?? ''} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={tGenerated('m_0decefd558c355')} required className="sm:col-span-2">
            <Input name="title" required placeholder={tGenerated('m_0915692fccfff8')} />
          </Field>
          <Field label={tGenerated('m_14d923495cf14c')} className="sm:col-span-2">
            <Textarea name="description" rows={3} placeholder={tGenerated('m_1d4bdebb9135a7')} />
          </Field>
          <Field label={tGenerated('m_1a298419b85cba')}>
            <RemoteSelectField
              lookup="corrective-action-owners"
              name="ownerTenantUserId"
              defaultValue={membershipId}
              initialOption={
                membershipId
                  ? { value: membershipId, label: ctx.membership?.displayName ?? '' }
                  : undefined
              }
              placeholder={tGenerated('m_0969d994e26813')}
              searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
              sheetTitle="Select a person"
              emptyLabel="—"
            />
          </Field>
          <Field label={tGenerated('m_168b365cc671bf')} required>
            <Select name="severity" defaultValue="medium">
              {correctiveActionSeverity.enumValues.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tGenerated('m_1d05fa7a091a9b')}>
            <Select name="source" defaultValue={presetSourceType ?? 'observation'}>
              {correctiveActionSource.enumValues.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tGenerated('m_020146dd3d3d5a')}>
            <RemoteSelectField
              lookup="corrective-action-sites"
              name="siteOrgUnitId"
              placeholder={tGenerated('m_015c668f21e7b9')}
              searchPlaceholder={tGenerated('m_1931aa93098220')}
              sheetTitle="Select a site"
              emptyLabel="—"
            />
          </Field>
          <Field label={tGenerated('m_04bfc1eaee3a4b')}>
            <Input name="dueOn" type="date" />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="submit">
            <GeneratedText id="m_0db5c2019349bf" />
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
