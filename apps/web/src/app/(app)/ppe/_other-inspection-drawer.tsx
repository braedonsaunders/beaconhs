import { eq } from 'drizzle-orm'
import { UrlDrawer } from '@beaconhs/ui'
import { ppeTypes } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { isUuid } from '@/lib/list-params'
import { loadInspectionCriteriaForType } from './_lib'
import { PpeInspectionForm } from './_inspection-form'
import { OtherPpeTypePicker } from './_other-inspection-type-picker'

/** The URL-driven "Inspect other PPE" flyout: pick a type, then its checklist. */
export async function PpeOtherInspectionDrawer({
  ctx,
  open,
  typeId,
  basePath,
}: {
  ctx: RequestContext
  open: boolean
  typeId: string | undefined
  basePath: '/ppe' | '/ppe/inspections'
}) {
  if (!open || !can(ctx, 'ppe.inspect')) return null
  const tGenerated = await getGeneratedTranslations()
  const chosen =
    typeId && isUuid(typeId)
      ? await (async () => {
          const [type] = await ctx.db((tx) =>
            tx
              .select({ id: ppeTypes.id, name: ppeTypes.name })
              .from(ppeTypes)
              .where(eq(ppeTypes.id, typeId))
              .limit(1),
          )
          if (!type) return null
          const criteria = await loadInspectionCriteriaForType(ctx, type.id, 'pre_use')
          return criteria.length > 0 ? { type, criteria } : null
        })()
      : null

  if (chosen) {
    return (
      <PpeInspectionForm
        open
        closeHref={basePath}
        title={tGenerated('m_14b75074ab6734')}
        description={tGenerated('m_188f7953dac2fc')}
        target={{
          kind: 'other',
          typeName: chosen.type.name,
          changeTypeHref: `${basePath}?drawer=inspect-other`,
          returnTo: basePath,
        }}
        typeId={chosen.type.id}
        kind="pre_use"
        criteria={chosen.criteria}
      />
    )
  }

  return (
    <UrlDrawer
      open
      closeHref={basePath}
      title={tGenerated('m_14b75074ab6734')}
      description={tGenerated('m_188f7953dac2fc')}
      size="md"
    >
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          <GeneratedText id="m_0bdc13fe741bfd" />
        </p>
        <OtherPpeTypePicker basePath={basePath} />
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_1ee0d97eb2dc15" />
        </p>
      </div>
    </UrlDrawer>
  )
}
