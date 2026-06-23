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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { loadEntitiesForPickers } from '@/app/(app)/apps/_lib/entity-loader'
import { appVisibleTo, getUserRoleKeys } from '@/app/(app)/apps/_lib/access'
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
  const responseIdParam = typeof sp.responseId === 'string' ? sp.responseId : null
  const returnTo =
    typeof sp.returnTo === 'string' && sp.returnTo.startsWith('/') && !sp.returnTo.startsWith('//')
      ? sp.returnTo
      : null

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

    // If a `?responseId=` param is present and points at a response owned by
    // this tenant, load it. Drafts/in-progress hydrate the editable filler;
    // submitted/closed responses render read-only from their final `data`
    // (this is the unified record page — edit if permitted, else view).
    let responseRow: {
      id: string
      status: string
      data: Record<string, unknown>
      draftData: FormResponseDraftData | null
      draftStepIndex: number | null
    } | null = null
    if (responseIdParam) {
      const [row] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          data: formResponses.data,
          draftData: formResponses.draftData,
          draftStepIndex: formResponses.draftStepIndex,
          templateId: formResponses.templateId,
        })
        .from(formResponses)
        .where(and(eq(formResponses.id, responseIdParam), eq(formResponses.tenantId, ctx.tenantId)))
        .limit(1)
      if (row && row.templateId === id) {
        responseRow = {
          id: row.id,
          status: row.status,
          data: row.data ?? {},
          draftData: row.draftData,
          draftStepIndex: row.draftStepIndex,
        }
      }
    }

    const [sites, allPeople, currentPerson] = await Promise.all([
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'site'))
        .orderBy(asc(orgUnits.name)),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
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
      responseRow,
    }
  })

  if (!data) notFound()

  // Access gating. Filling the app (creating / editing) requires the app's
  // roles. Viewing an existing entry read-only is also allowed for reviewers
  // with `forms.response.read.all`.
  const userRoleKeys = await getUserRoleKeys(ctx)
  const canFillApp = appVisibleTo(ctx, data.tmpl.allowedRoles, userRoleKeys)
  const response = data.responseRow
  const canView = canFillApp || can(ctx, 'forms.response.read.all')
  if (response) {
    if (!canView) notFound()
  } else if (!canFillApp) {
    // No existing entry → this is a "new entry" attempt, which needs fill access.
    notFound()
  }

  // A response is editable only while in a pre-submit state AND the user can
  // fill the app. Submitted/closed entries (or view-only users) render
  // read-only — the same record surface, just locked.
  const isDraftState =
    response !== null && (response.status === 'draft' || response.status === 'in_progress')
  const editable = canFillApp && (response === null || isDraftState)
  const readOnly = !editable
  // Reviewers/admins get a link to the richer review surface (CAPA/comments/
  // audit/sign-off) for an existing response.
  const reviewHref =
    response && can(ctx, 'forms.response.read.all') ? `/apps/responses/${response.id}` : null

  // Hydrate the renderer: drafts from draftData; submitted/closed from the
  // final `data` (repeating-section rows live at data[sectionId]).
  let initialValues: Record<string, unknown> = {}
  let initialRows: Record<string, Array<Record<string, unknown>>> = {}
  let initialStepIndex = 0
  if (response) {
    if (isDraftState && response.draftData) {
      initialValues = response.draftData.values ?? {}
      initialRows = response.draftData.rows ?? {}
      initialStepIndex = response.draftStepIndex ?? 0
    } else {
      initialValues = response.data ?? {}
      initialRows = {}
      for (const sec of data.version.schema.sections) {
        const rows = response.data?.[sec.id]
        if (sec.repeating && Array.isArray(rows)) {
          initialRows[sec.id] = rows as Array<Record<string, unknown>>
        }
      }
    }
  }
  const initialResponseId = response?.id ?? null
  const resumeOk = isDraftState && !!response?.draftData

  // Resolve picker-bound entity attributes. We pass the resumed values map
  // (or {}) so any picker selections in the draft rehydrate with their
  // entity-attr cache populated. On a brand-new response there's nothing
  // selected yet, so this returns picker → null entries.
  const entitiesByField = await loadEntitiesForPickers(ctx, data.version.schema, initialValues)

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
        name: data.currentPerson
          ? `${data.currentPerson.firstName} ${data.currentPerson.lastName}`
          : (ctx.membership?.displayName ?? null),
      }}
      initialResponseId={initialResponseId}
      initialValues={initialValues}
      initialRows={initialRows}
      initialStepIndex={initialStepIndex}
      isResumed={resumeOk}
      returnTo={returnTo}
      readOnly={readOnly}
      responseStatus={response?.status ?? null}
      reviewHref={reviewHref}
    />
  )
}
