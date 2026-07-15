import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// Server component: renders a record's tenant-defined custom fields, grouped by
// their optional section heading. Returns null when no fields are defined for
// the kind/subtype, so detail pages can mount it unconditionally without
// introducing an empty card. Reuses the autosave <CustomFieldInput>.

import { readCustomFieldValues, type CustomFieldEntityKind } from '@beaconhs/forms-core'
import { Section } from '@/components/section'
import { requireRequestContext } from '@/lib/auth'
import { loadVisibleCustomFieldDefs, type CustomFieldDefRow } from '@/lib/custom-fields/queries'
import { updateCustomFieldValueAction } from '@/lib/custom-fields/actions'
import { CustomFieldInput } from './custom-field-input'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

export async function CustomFieldsSection({
  ctx,
  entityKind,
  recordId,
  subtypeId,
  metadata,
  locked,
  defs: defsProp,
}: {
  ctx: Ctx
  entityKind: CustomFieldEntityKind
  recordId: string
  subtypeId: string | null
  metadata: Record<string, unknown> | null | undefined
  locked: boolean
  /**
   * Pre-loaded definitions (callers that split fields between native field
   * groups and standalone sections load once and pass the remainder here).
   */
  defs?: CustomFieldDefRow[]
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const defs = defsProp ?? (await loadVisibleCustomFieldDefs(ctx, entityKind, subtypeId))
  if (defs.length === 0) return null

  const values = readCustomFieldValues(metadata)

  // Group by heading, preserving the registry's sort order. The null group
  // (fields with no heading) renders first under a generic title.
  const groups = new Map<string, CustomFieldDefRow[]>()
  for (const def of defs) {
    const key = def.groupLabel ?? ''
    const list = groups.get(key) ?? []
    list.push(def)
    groups.set(key, list)
  }

  return (
    <>
      <GeneratedValue
        value={[...groups.entries()].map(([groupLabel, list]) => (
          <Section
            key={groupLabel || '__default'}
            title={tGeneratedValue(groupLabel || tGenerated('m_0fbbb37902b3de'))}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <GeneratedValue
                value={list.map((def) => (
                  <CustomFieldInput
                    key={def.id}
                    entityKind={entityKind}
                    recordId={recordId}
                    def={{
                      key: def.key,
                      label: def.label,
                      helpText: def.helpText,
                      fieldType: def.fieldType,
                      required: def.required,
                      config: def.config,
                    }}
                    initialValue={values[def.key] ?? null}
                    disabled={locked}
                    updateAction={updateCustomFieldValueAction}
                  />
                ))}
              />
            </div>
          </Section>
        ))}
      />
    </>
  )
}
