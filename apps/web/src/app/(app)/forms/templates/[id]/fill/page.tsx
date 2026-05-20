import { notFound } from 'next/navigation'
import { asc, desc, eq } from 'drizzle-orm'
import {
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { loadEntitiesForPickers } from '@/app/(app)/forms/_lib/entity-loader'
import { FormRenderer } from './form-renderer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Fill · ${id.slice(0, 8)}` }
}

export default async function FillTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1)
    if (!tmpl) return null
    const [version] = await tx
      .select()
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, id))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) return null
    const [sites, allPeople, currentPerson] = await Promise.all([
      tx.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.level, 'site')).orderBy(asc(orgUnits.name)),
      tx
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .orderBy(asc(people.lastName), asc(people.firstName)),
      // Look up the active user's person record (if any) — used for the
      // `current_user_person_id` / `current_user_name` default-value resolvers.
      tx
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(eq(people.userId, ctx.userId ?? ''))
        .limit(1),
    ])
    return { tmpl, version, sites, people: allPeople, currentPerson: currentPerson[0] ?? null }
  })

  if (!data) notFound()

  // Resolve picker-bound entity attributes for any default-valued pickers.
  // On a brand-new response there's nothing selected yet, so this returns a
  // map of `pickerFieldKey → null` — the client refreshes entries on picker
  // change via the `fetchEntityAttrs` server action.
  const entitiesByField = await loadEntitiesForPickers(ctx, data.version.schema, {})

  return (
    <FormRenderer
      templateId={data.tmpl.id}
      templateName={data.tmpl.name}
      version={data.version.version}
      schema={data.version.schema}
      sites={data.sites}
      people={data.people}
      entitiesByField={entitiesByField}
      currentUser={{
        personId: data.currentPerson?.id ?? null,
        name:
          data.currentPerson
            ? `${data.currentPerson.firstName} ${data.currentPerson.lastName}`
            : ctx.membership?.displayName ?? null,
      }}
    />
  )
}
