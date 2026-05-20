import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { loadEntitiesForPickers } from '@/app/(app)/forms/_lib/entity-loader'
import { FormRenderer } from './form-renderer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Fill · ${id.slice(0, 8)}` }
}

export default async function FillTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const responseIdParam =
    typeof sp.responseId === 'string' ? sp.responseId : null

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

    // If a `?responseId=` param is present and points at a draft owned by
    // this tenant, hydrate the filler with the saved draft state. Otherwise
    // the page renders an empty form and the client lazily creates a draft
    // row on the user's first content change.
    let draftResponse: {
      id: string
      draftData: FormResponseDraftData | null
      draftStepIndex: number | null
      status: string
    } | null = null
    if (responseIdParam) {
      const [row] = await tx
        .select({
          id: formResponses.id,
          draftData: formResponses.draftData,
          draftStepIndex: formResponses.draftStepIndex,
          status: formResponses.status,
          templateId: formResponses.templateId,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, responseIdParam),
            eq(formResponses.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
      if (row && row.templateId === id) {
        draftResponse = {
          id: row.id,
          draftData: row.draftData,
          draftStepIndex: row.draftStepIndex,
          status: row.status,
        }
      }
    }

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
    return {
      tmpl,
      version,
      sites,
      people: allPeople,
      currentPerson: currentPerson[0] ?? null,
      draftResponse,
    }
  })

  if (!data) notFound()

  // Resume-path: if we found a draft response AND it's still in a pre-submit
  // state, pull the persisted values + rows back into the renderer.
  // Submitted/closed/etc. drafts ignore the param so we don't accidentally
  // let users re-edit completed work.
  const resumeOk =
    data.draftResponse !== null &&
    data.draftResponse.draftData !== null &&
    (data.draftResponse.status === 'draft' ||
      data.draftResponse.status === 'in_progress')
  const initialValues: Record<string, unknown> = resumeOk
    ? (data.draftResponse!.draftData!.values ?? {})
    : {}
  const initialRows: Record<string, Array<Record<string, unknown>>> = resumeOk
    ? (data.draftResponse!.draftData!.rows ?? {})
    : {}
  const initialStepIndex = resumeOk
    ? (data.draftResponse!.draftStepIndex ?? 0)
    : 0
  const initialResponseId = data.draftResponse?.id ?? null

  // Resolve picker-bound entity attributes. We pass the resumed values map
  // (or {}) so any picker selections in the draft rehydrate with their
  // entity-attr cache populated. On a brand-new response there's nothing
  // selected yet, so this returns picker → null entries.
  const entitiesByField = await loadEntitiesForPickers(
    ctx,
    data.version.schema,
    initialValues,
  )

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
      initialResponseId={initialResponseId}
      initialValues={initialValues}
      initialRows={initialRows}
      initialStepIndex={initialStepIndex}
      isResumed={resumeOk}
    />
  )
}
