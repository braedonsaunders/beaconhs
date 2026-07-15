import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound, redirect } from 'next/navigation'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
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
import { canAccessTemplate, canEditResponsePayload } from '@/app/(app)/apps/_lib/access'
import { parseBuilderReturnTo } from '@/app/(app)/apps/_lib/return-to'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { isUuid } from '@/lib/list-params'
import { canSeeRecord } from '@/lib/visibility'
import { loadApplicableFormObligation } from '@/lib/forms/form-compliance-obligation'
import { FormRenderer } from './form-renderer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0d322720da7266', { value0: id.slice(0, 8) }) }
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
  const obligationIdParam = typeof sp.obligationId === 'string' ? sp.obligationId : null
  const returnTo = parseBuilderReturnTo(sp.returnTo)
  if (
    !isUuid(id) ||
    (responseIdParam !== null && !isUuid(responseIdParam)) ||
    (obligationIdParam !== null && !isUuid(obligationIdParam))
  )
    notFound()

  const ctx = await requireRequestContext()
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  const accessMode = responseIdParam ? 'browse-records' : 'operate'
  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .select()
      .from(formTemplates)
      .where(and(eq(formTemplates.id, id), isNull(formTemplates.deletedAt)))
      .limit(1)
    if (!tmpl) return null
    if (!canAccessTemplate(ctx, tmpl, effectiveRoleKeys, accessMode)) return null
    // If a `?responseId=` param is present and points at a response owned by
    // this tenant, load it. Drafts/in-progress hydrate the editable filler;
    // submitted/closed responses render read-only from their final `data`
    // (this is the unified record page — edit if permitted, else view).
    let responseRow: {
      id: string
      status: string
      locked: boolean
      data: Record<string, unknown>
      draftData: FormResponseDraftData | null
      draftStepIndex: number | null
      templateVersionId: string
      submittedBy: string | null
      subjectPersonId: string | null
      siteOrgUnitId: string | null
      complianceObligationId: string | null
    } | null = null
    if (responseIdParam) {
      const [row] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          locked: formResponses.locked,
          data: formResponses.data,
          draftData: formResponses.draftData,
          draftStepIndex: formResponses.draftStepIndex,
          templateId: formResponses.templateId,
          templateVersionId: formResponses.templateVersionId,
          submittedBy: formResponses.submittedBy,
          subjectPersonId: formResponses.subjectPersonId,
          siteOrgUnitId: formResponses.siteOrgUnitId,
          complianceObligationId: formResponses.complianceObligationId,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, responseIdParam),
            eq(formResponses.tenantId, ctx.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .limit(1)
      if (row && row.templateId === id) {
        responseRow = {
          id: row.id,
          status: row.status,
          locked: row.locked,
          data: row.data ?? {},
          draftData: row.draftData,
          draftStepIndex: row.draftStepIndex,
          templateVersionId: row.templateVersionId,
          submittedBy: row.submittedBy,
          subjectPersonId: row.subjectPersonId,
          siteOrgUnitId: row.siteOrgUnitId,
          complianceObligationId: row.complianceObligationId,
        }
      }
      if (!responseRow) return null
      const visible = await canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [responseRow.submittedBy],
        personId: responseRow.subjectPersonId,
        siteId: responseRow.siteOrgUnitId,
      })
      if (!visible) return null
    }

    if (
      responseRow &&
      obligationIdParam &&
      responseRow.complianceObligationId !== obligationIdParam
    ) {
      return null
    }
    const linkedObligation = responseRow
      ? null
      : obligationIdParam
        ? await loadApplicableFormObligation(tx, {
            tenantId: ctx.tenantId,
            obligationId: obligationIdParam,
            templateId: id,
            personId: ctx.personId,
          })
        : null
    if (!responseRow && obligationIdParam && !linkedObligation) return null

    // Existing responses are immutable snapshots of the template version they
    // started on. Loading the latest version here would render one schema while
    // the row still referenced another, corrupting resumed drafts after publish.
    const [version] = await tx
      .select()
      .from(formTemplateVersions)
      .where(
        responseRow
          ? and(
              eq(formTemplateVersions.id, responseRow.templateVersionId),
              eq(formTemplateVersions.templateId, id),
            )
          : and(
              eq(formTemplateVersions.templateId, id),
              eq(formTemplateVersions.tenantId, ctx.tenantId),
              isNotNull(formTemplateVersions.publishedAt),
            ),
      )
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) return null

    const [sites, allPeople, currentPerson] = await Promise.all([
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
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
      complianceObligationId: responseRow?.complianceObligationId ?? linkedObligation?.id ?? null,
    }
  })

  if (!data) notFound()

  const response = data.responseRow
  const canFillApp =
    can(ctx, 'forms.response.create') &&
    canAccessTemplate(ctx, data.tmpl, effectiveRoleKeys, 'operate')
  if (response) {
    // Template and per-record visibility were both enforced in the scoped load.
    // Keep this explicit lifecycle check to make later refactors fail closed.
    if (!canAccessTemplate(ctx, data.tmpl, effectiveRoleKeys, 'browse-records')) notFound()
  } else if (!canFillApp) {
    // No existing entry → this is a "new entry" attempt, which needs fill access.
    notFound()
  }
  if (response && !returnTo) redirect(`/apps/responses/${response.id}`)

  // A response is editable only while in a pre-submit state AND the user can
  // fill the app. Submitted/closed entries (or view-only users) render
  // read-only — the same record surface, just locked.
  const isDraftState =
    response !== null && (response.status === 'draft' || response.status === 'in_progress')
  const editable = response
    ? isDraftState &&
      canAccessTemplate(ctx, data.tmpl, effectiveRoleKeys, 'operate') &&
      canEditResponsePayload(ctx, response)
    : canFillApp
  const readOnly = !editable
  // Reviewers/admins get a link to the richer review surface (CAPA/comments/
  // audit/sign-off) for an existing response.
  // The record page IS the review surface now — no separate Review round-trip.
  const reviewHref = null

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
      initialDraftRevision={response?.draftData?.saveRevision ?? 0}
      isResumed={resumeOk}
      returnTo={returnTo}
      readOnly={readOnly}
      responseStatus={response?.status ?? null}
      reviewHref={reviewHref}
      complianceObligationId={data.complianceObligationId}
    />
  )
}
