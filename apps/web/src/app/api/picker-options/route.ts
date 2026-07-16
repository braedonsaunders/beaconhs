import { NextResponse } from 'next/server'
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  correctiveActions,
  departments,
  documents,
  equipmentCategories,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentTypes,
  equipmentWorkOrders,
  formTemplates,
  incidentClassifications,
  incidentInjuryTypes,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  people,
  personTitles,
  ppeTypes,
  roles,
  tenantUsers,
  trainingAssessments,
  trainingAssessmentTypes,
  trainingClasses,
  trainingClassAttendees,
  trainingContentItems,
  trainingCourses,
  trainingEnrollments,
  trainingSkillTypes,
  trainingSkillAuthorities,
  trades,
  users,
} from '@beaconhs/db/schema'
import { primaryPersonTitleName } from '@beaconhs/db'
import { can, type RequestContext } from '@beaconhs/tenant'
import { getRequestContext } from '../../../lib/auth'
import { getEffectiveRoleKeys } from '../../../lib/effective-roles'
import { moduleAdminByKey } from '../../../lib/module-admin/registry'
import {
  boundPickerOptions,
  isPickerLookup,
  PICKER_RESULT_LIMIT,
  type PickerLookup,
  type PickerOptionsResponse,
} from '../../../lib/picker-options'
import { isUuid } from '../../../lib/list-params'
import { moduleScopeWhere } from '../../../lib/visibility'
import { templateAccessWhere } from '../../(app)/apps/_lib/access'
import { resolveVehicleEquipmentWhere } from '../../(app)/equipment/vehicle-log/_equipment-policy'
import { loadEquipmentStationPickerOptions } from '../../../lib/equipment-station-picker'

export const dynamic = 'force-dynamic'

const MAX_QUERY_LENGTH = 100

type Option = PickerOptionsResponse['options'][number]
type PickerQuery = {
  term: string
  hasQuery: boolean
  selected: string | null
  selectedKey: string | null
  contextId: string | null
}
type PersonOptionRow = {
  id: string
  firstName: string
  lastName: string
  employeeNo: string | null
  jobTitle: string | null
}

const PERSON_OPTION_SELECTION = {
  id: people.id,
  firstName: people.firstName,
  lastName: people.lastName,
  employeeNo: people.employeeNo,
  jobTitle: primaryPersonTitleName(people.id, people.tenantId),
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`)
}

function option(value: string, label: string, hint?: string | null, meta?: Option['meta']): Option {
  return {
    value,
    label: label.trim().slice(0, 240),
    ...(hint ? { hint: hint.trim().slice(0, 120) } : {}),
    ...(meta ? { meta } : {}),
  }
}

function personMatch(input: PickerQuery): SQL | undefined {
  if (!input.hasQuery) return undefined
  return or(
    ilike(people.firstName, input.term),
    ilike(people.lastName, input.term),
    ilike(people.employeeNo, input.term),
    ilike(primaryPersonTitleName(people.id, people.tenantId), input.term),
    ilike(sql<string>`(${people.firstName} || ' ' || ${people.lastName})`, input.term),
    input.selected ? eq(people.id, input.selected) : undefined,
  )
}

function personOrder(selected: string | null): SQL[] {
  return [
    ...(selected ? [desc(sql`${people.id} = ${selected}`)] : []),
    asc(people.lastName),
    asc(people.firstName),
    asc(people.id),
  ]
}

function personOptions(rows: PersonOptionRow[]): Option[] {
  return rows.map((row) =>
    option(
      row.id,
      `${row.lastName}, ${row.firstName}`,
      [row.employeeNo, row.jobTitle].filter(Boolean).join(' · '),
    ),
  )
}

function labelForFormKind(kind: string): string {
  switch (kind) {
    case 'wizard':
      return 'Wizard'
    case 'checklist':
      return 'Checklist'
    case 'register':
      return 'Register'
    case 'mini_app':
      return 'App'
    default:
      return 'Form'
  }
}

function equipmentInspectionTypeHint(
  isPreUse: boolean,
  intervalValue: number | null,
  intervalUnit: 'day' | 'week' | 'month' | 'year' | null,
): string {
  if (isPreUse) return 'Pre-use'
  if (!intervalValue || !intervalUnit) return 'On demand'
  return `Every ${intervalValue} ${intervalUnit}${intervalValue === 1 ? '' : 's'}`
}

function pickerAuthorized(ctx: RequestContext, lookup: PickerLookup): boolean {
  const canAny = (...permissions: string[]) =>
    ctx.isSuperAdmin || permissions.some((permission) => can(ctx, permission))
  const canManage = (moduleKey: string) => {
    const moduleConfig = moduleAdminByKey(moduleKey)
    return !!moduleConfig && (ctx.isSuperAdmin || can(ctx, moduleConfig.permission))
  }
  switch (lookup) {
    case 'training-evaluation-people':
      return canManage('training')
    case 'training-course-assessment-types':
    case 'training-course-classes':
    case 'training-course-library-content':
    case 'training-course-library-slides':
      return canManage('training')
    case 'training-assessment-people':
    case 'training-assessment-types':
    case 'training-assessment-courses':
      return (
        can(ctx, 'training.record.create') ||
        can(ctx, 'training.class.manage') ||
        can(ctx, 'training.read.all') ||
        can(ctx, 'training.read.self')
      )
    case 'training-class-courses':
    case 'training-class-sites':
    case 'training-class-instructors':
    case 'training-class-attendee-candidates':
      return can(ctx, 'training.class.manage')
    case 'training-skill-assignment-people':
    case 'training-skill-assignment-types':
      return canManage('training')
    case 'journal-locations':
    case 'journal-supervisors':
      return (
        can(ctx, 'journals.create') ||
        can(ctx, 'journals.update.own') ||
        can(ctx, 'journals.assign')
      )
    case 'safe-distance-sites':
    case 'safe-distance-supervisors':
    case 'safe-distance-operators':
      return can(ctx, 'tools.safe-distance.use')
    case 'compliance-by-person':
      return can(ctx, 'compliance.read')
    case 'location-parent-units':
      return can(ctx, 'admin.org.manage')
    case 'document-signoff-sites':
      return can(ctx, 'documents.manage')
    case 'incident-sites':
    case 'incident-departments':
    case 'incident-classifications':
    case 'incident-people':
    case 'incident-injury-types':
      return (
        can(ctx, 'incidents.create') ||
        can(ctx, 'incidents.update') ||
        can(ctx, 'incidents.investigate')
      )
    case 'inspection-sites':
    case 'inspection-people':
      return can(ctx, 'inspections.update') || can(ctx, 'inspections.create')
    case 'inspection-record-filter-types':
    case 'inspection-record-filter-sites':
    case 'inspection-record-filter-inspectors':
      return canAny(
        'inspections.read.all',
        'inspections.read.site',
        'inspections.read.self',
        'inspections.create',
        'inspections.update',
        'inspections.manage',
      )
    case 'corrective-action-sites':
    case 'corrective-action-owners':
      return can(ctx, 'ca.create') || can(ctx, 'ca.update')
    case 'document-signoff-people':
    case 'management-review-members':
    case 'management-review-documents':
    case 'management-review-actions':
    case 'document-book-documents':
      return can(ctx, 'documents.manage')
    case 'ppe-active-people':
      return can(ctx, 'ppe.issue') || can(ctx, 'ppe.manage')
    case 'ppe-types':
      return can(ctx, 'ppe.manage')
    case 'vehicle-equipment':
    case 'vehicle-customers':
    case 'vehicle-drivers':
    case 'equipment-custody-holders':
    case 'equipment-custody-sites':
    case 'equipment-station-holders':
    case 'equipment-station-locations':
    case 'equipment-reminder-assignees':
    case 'equipment-reminder-items':
      return can(ctx, 'equipment.manage')
    case 'equipment-inspection-items':
      return can(ctx, 'equipment.inspect')
    case 'equipment-work-order-assignees':
    case 'equipment-work-order-reporters':
      return can(ctx, 'equipment.workorder.create') || can(ctx, 'equipment.workorder.close')
    case 'equipment-work-order-items':
      return can(ctx, 'equipment.workorder.create')
    case 'equipment-types':
      return can(ctx, 'equipment.read.site')
    case 'equipment-work-order-filter-assignees':
    case 'equipment-work-order-filter-types':
      return canAny(
        'equipment.read.all',
        'equipment.read.site',
        'equipment.manage',
        'equipment.workorder.create',
        'equipment.workorder.close',
      )
    case 'equipment-edit-types':
    case 'equipment-edit-categories':
    case 'equipment-item-inspection-types':
    case 'equipment-item-pre-use-inspection-types':
      return can(ctx, 'equipment.manage') || can(ctx, 'equipment.inspect')
    case 'incident-classification-parents':
      return canManage('incidents')
    case 'compliance-obligation-inspection-types':
    case 'compliance-obligation-documents':
    case 'compliance-obligation-courses':
    case 'compliance-obligation-assessment-types':
    case 'compliance-obligation-skill-types':
    case 'compliance-obligation-form-templates':
    case 'compliance-obligation-equipment-types':
    case 'compliance-obligation-ppe-types':
    case 'compliance-obligation-job-titles':
    case 'compliance-obligation-audience-roles':
    case 'compliance-obligation-audience-trades':
    case 'compliance-obligation-audience-departments':
    case 'compliance-obligation-audience-people':
    case 'compliance-obligation-audience-org-units':
      return can(ctx, 'compliance.assign') || can(ctx, 'compliance.manage')
    case 'dashboard-quick-action-forms':
      return can(ctx, 'forms.response.create')
    case 'admin-navigation-form-templates':
      return can(ctx, 'admin.nav.manage')
  }
}

function json(body: PickerOptionsResponse, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  })
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const lookupParam = url.searchParams.get('lookup')
  if (!isPickerLookup(lookupParam)) return json({ options: [], hasMore: false }, 400)

  const contextIdParam = url.searchParams.get('contextId')
  const contextRequired =
    lookupParam === 'training-evaluation-people' ||
    lookupParam === 'training-course-classes' ||
    lookupParam === 'training-class-attendee-candidates'
  if (
    (contextRequired && !contextIdParam) ||
    (contextIdParam !== null && !isUuid(contextIdParam))
  ) {
    return json({ options: [], hasMore: false }, 400)
  }

  const ctx = await getRequestContext()
  if (!ctx) return json({ options: [], hasMore: false }, 401)
  if (!pickerAuthorized(ctx, lookupParam)) return json({ options: [], hasMore: false }, 403)

  const rawQuery = (url.searchParams.get('q') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
  const term = `%${escapeIlike(rawQuery)}%`
  const selectedParam = url.searchParams.get('selected')
  const selected = selectedParam && isUuid(selectedParam) ? selectedParam : null
  const selectedKey =
    selectedParam && /^[a-z0-9][a-z0-9._:-]{0,99}$/i.test(selectedParam) ? selectedParam : null

  try {
    const response = await loadOptions(ctx, lookupParam, {
      term,
      // A selected value must participate in the result predicate even before
      // the user types, otherwise an existing value beyond the first page
      // cannot hydrate its label.
      hasQuery: rawQuery.length > 0 || selected !== null || selectedKey !== null,
      selected,
      selectedKey,
      contextId: contextIdParam,
    })
    return json(response)
  } catch (error) {
    console.error('[picker-options] query failed', { lookup: lookupParam, error })
    return json({ options: [], hasMore: false }, 500)
  }
}

async function loadOptions(
  ctx: RequestContext,
  lookup: PickerLookup,
  input: PickerQuery,
): Promise<PickerOptionsResponse> {
  return ctx.db(async (tx) => {
    if (lookup === 'equipment-station-holders' || lookup === 'equipment-station-locations') {
      return loadEquipmentStationPickerOptions(
        tx,
        ctx.tenantId,
        lookup === 'equipment-station-holders' ? 'holder' : 'location',
        { term: input.hasQuery ? input.term : null, selected: input.selected },
      )
    }

    if (lookup === 'compliance-obligation-audience-people') {
      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(and(eq(people.status, 'active'), isNull(people.deletedAt), personMatch(input)))
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (lookup === 'compliance-obligation-audience-roles') {
      const match = input.hasQuery
        ? or(
            ilike(roles.name, input.term),
            ilike(roles.key, input.term),
            input.selectedKey ? eq(roles.key, input.selectedKey) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ key: roles.key, name: roles.name })
        .from(roles)
        .where(match)
        .orderBy(
          ...(input.selectedKey ? [desc(sql`${roles.key} = ${input.selectedKey}`)] : []),
          asc(roles.name),
          asc(roles.key),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.key, row.name, row.key)))
    }

    if (lookup === 'compliance-obligation-audience-departments') {
      const match = input.hasQuery
        ? or(
            ilike(departments.name, input.term),
            ilike(departments.code, input.term),
            input.selected ? eq(departments.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: departments.id, name: departments.name, code: departments.code })
        .from(departments)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${departments.id} = ${input.selected}`)] : []),
          asc(departments.name),
          asc(departments.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (lookup === 'compliance-obligation-audience-trades') {
      const match = input.hasQuery
        ? or(
            ilike(trades.name, input.term),
            ilike(trades.code, input.term),
            input.selected ? eq(trades.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trades.id, name: trades.name, code: trades.code })
        .from(trades)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${trades.id} = ${input.selected}`)] : []),
          asc(trades.name),
          asc(trades.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (
      lookup === 'compliance-obligation-audience-org-units' ||
      lookup === 'document-signoff-sites'
    ) {
      const match = input.hasQuery
        ? or(
            ilike(orgUnits.name, input.term),
            ilike(orgUnits.code, input.term),
            input.selected ? eq(orgUnits.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          code: orgUnits.code,
          level: orgUnits.level,
        })
        .from(orgUnits)
        .where(
          and(isNull(orgUnits.deletedAt), sql`${orgUnits.level} in ('site', 'project')`, match),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, `${row.name} (${row.level})`, row.code)),
      )
    }

    if (lookup === 'compliance-obligation-inspection-types') {
      const match = input.hasQuery
        ? or(
            ilike(inspectionTypes.name, input.term),
            input.selected ? eq(inspectionTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: inspectionTypes.id, name: inspectionTypes.name })
        .from(inspectionTypes)
        .where(and(eq(inspectionTypes.isPublished, true), isNull(inspectionTypes.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${inspectionTypes.id} = ${input.selected}`)] : []),
          asc(inspectionTypes.name),
          asc(inspectionTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'compliance-obligation-documents') {
      const match = input.hasQuery
        ? or(
            ilike(documents.title, input.term),
            ilike(documents.key, input.term),
            input.selected ? eq(documents.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: documents.id, title: documents.title, key: documents.key })
        .from(documents)
        .where(and(isNull(documents.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${documents.id} = ${input.selected}`)] : []),
          asc(documents.title),
          asc(documents.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.title, row.key)))
    }

    if (lookup === 'compliance-obligation-courses') {
      const match = input.hasQuery
        ? or(
            ilike(trainingCourses.name, input.term),
            ilike(trainingCourses.code, input.term),
            input.selected ? eq(trainingCourses.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .where(and(isNull(trainingCourses.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingCourses.id} = ${input.selected}`)] : []),
          asc(trainingCourses.name),
          asc(trainingCourses.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, `${row.code ? `${row.code} · ` : ''}${row.name}`)),
      )
    }

    if (lookup === 'compliance-obligation-assessment-types') {
      const match = input.hasQuery
        ? or(
            ilike(trainingAssessmentTypes.name, input.term),
            input.selected ? eq(trainingAssessmentTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
        .from(trainingAssessmentTypes)
        .where(and(isNull(trainingAssessmentTypes.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingAssessmentTypes.id} = ${input.selected}`)] : []),
          asc(trainingAssessmentTypes.name),
          asc(trainingAssessmentTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'compliance-obligation-skill-types') {
      const match = input.hasQuery
        ? or(
            ilike(trainingSkillTypes.name, input.term),
            ilike(trainingSkillTypes.code, input.term),
            input.selected ? eq(trainingSkillTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: trainingSkillTypes.id,
          name: trainingSkillTypes.name,
          code: trainingSkillTypes.code,
        })
        .from(trainingSkillTypes)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingSkillTypes.id} = ${input.selected}`)] : []),
          asc(trainingSkillTypes.name),
          asc(trainingSkillTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, `${row.code ? `${row.code} · ` : ''}${row.name}`)),
      )
    }

    if (
      lookup === 'compliance-obligation-form-templates' ||
      lookup === 'dashboard-quick-action-forms' ||
      lookup === 'admin-navigation-form-templates'
    ) {
      const dashboard = lookup === 'dashboard-quick-action-forms'
      const navigation = lookup === 'admin-navigation-form-templates'
      const effectiveRoleKeys = navigation ? null : await getEffectiveRoleKeys(ctx, tx)
      const match = input.hasQuery
        ? or(
            ilike(formTemplates.name, input.term),
            ilike(formTemplates.key, input.term),
            ilike(formTemplates.category, input.term),
            dashboard
              ? input.selectedKey
                ? eq(formTemplates.key, input.selectedKey)
                : undefined
              : input.selected
                ? eq(formTemplates.id, input.selected)
                : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: formTemplates.id,
          key: formTemplates.key,
          name: formTemplates.name,
          category: formTemplates.category,
          iconKey: formTemplates.iconKey,
          kind: formTemplates.kind,
          status: formTemplates.status,
          surfaceAsTool: formTemplates.surfaceAsTool,
        })
        .from(formTemplates)
        .where(
          and(
            eq(formTemplates.tenantId, ctx.tenantId),
            navigation
              ? isNull(formTemplates.deletedAt)
              : templateAccessWhere(ctx, effectiveRoleKeys!, 'operate'),
            match,
          ),
        )
        .orderBy(
          ...(dashboard && input.selectedKey
            ? [desc(sql`${formTemplates.key} = ${input.selectedKey}`)]
            : !dashboard && input.selected
              ? [desc(sql`${formTemplates.id} = ${input.selected}`)]
              : []),
          ...(dashboard ? [desc(formTemplates.surfaceAsTool)] : []),
          asc(formTemplates.name),
          asc(formTemplates.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => {
          const hint = row.surfaceAsTool ? 'App' : labelForFormKind(row.kind)
          if (navigation) {
            return option(row.id, row.name, row.category ?? row.status, {
              kind: 'admin-navigation-template',
              category: row.category,
              iconKey: row.iconKey,
              status: row.status,
            })
          }
          if (!dashboard) return option(row.id, row.name, hint)
          return option(row.key, row.name, hint, {
            kind: 'dashboard-quick-action',
            href: `/apps/by-key/${encodeURIComponent(row.key)}/fill`,
            iconKey: row.iconKey?.trim().slice(0, 80) || (row.surfaceAsTool ? 'cog' : 'clipboard'),
            tone: row.surfaceAsTool ? 'violet' : 'sky',
          })
        }),
      )
    }

    if (lookup === 'compliance-obligation-equipment-types') {
      const match = input.hasQuery
        ? or(
            ilike(equipmentTypes.name, input.term),
            input.selected ? eq(equipmentTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${equipmentTypes.id} = ${input.selected}`)] : []),
          asc(equipmentTypes.name),
          asc(equipmentTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'compliance-obligation-ppe-types') {
      const match = input.hasQuery
        ? or(
            ilike(ppeTypes.name, input.term),
            ilike(ppeTypes.category, input.term),
            input.selected ? eq(ppeTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: ppeTypes.id, name: ppeTypes.name, category: ppeTypes.category })
        .from(ppeTypes)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${ppeTypes.id} = ${input.selected}`)] : []),
          asc(ppeTypes.name),
          asc(ppeTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.category)))
    }

    if (lookup === 'compliance-obligation-job-titles') {
      const match = input.hasQuery
        ? or(
            ilike(personTitles.name, input.term),
            input.selected ? eq(personTitles.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: personTitles.id, name: personTitles.name })
        .from(personTitles)
        .where(and(isNull(personTitles.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${personTitles.id} = ${input.selected}`)] : []),
          asc(personTitles.name),
          asc(personTitles.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'training-course-assessment-types') {
      const match = input.hasQuery
        ? or(
            ilike(trainingAssessmentTypes.name, input.term),
            input.selected ? eq(trainingAssessmentTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
        .from(trainingAssessmentTypes)
        .where(and(isNull(trainingAssessmentTypes.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingAssessmentTypes.id} = ${input.selected}`)] : []),
          asc(trainingAssessmentTypes.name),
          asc(trainingAssessmentTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'training-course-classes') {
      const courseId = input.contextId!
      const match = input.hasQuery
        ? or(
            ilike(trainingClasses.title, input.term),
            input.selected ? eq(trainingClasses.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: trainingClasses.id,
          title: trainingClasses.title,
          startsAt: trainingClasses.startsAt,
        })
        .from(trainingClasses)
        .where(and(eq(trainingClasses.courseId, courseId), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingClasses.id} = ${input.selected}`)] : []),
          desc(trainingClasses.startsAt),
          asc(trainingClasses.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, row.title, row.startsAt.toISOString().slice(0, 10))),
      )
    }

    if (
      lookup === 'training-course-library-content' ||
      lookup === 'training-course-library-slides'
    ) {
      const slides = lookup === 'training-course-library-slides'
      const match = input.hasQuery
        ? or(
            ilike(trainingContentItems.title, input.term),
            ilike(trainingContentItems.description, input.term),
            input.selected ? eq(trainingContentItems.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: trainingContentItems.id,
          title: trainingContentItems.title,
          kind: trainingContentItems.kind,
        })
        .from(trainingContentItems)
        .where(
          and(
            isNull(trainingContentItems.deletedAt),
            slides
              ? eq(trainingContentItems.kind, 'slides')
              : ne(trainingContentItems.kind, 'slides'),
            match,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingContentItems.id} = ${input.selected}`)] : []),
          asc(trainingContentItems.title),
          asc(trainingContentItems.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, row.title, row.kind.replace(/_/g, ' '))),
      )
    }

    if (lookup === 'training-evaluation-people') {
      const courseId = input.contextId!
      const [course] = await tx
        .select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
        .limit(1)
      if (!course) return boundPickerOptions([])

      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(
          and(
            isNull(people.deletedAt),
            eq(people.status, 'active'),
            personMatch(input),
            notExists(
              tx
                .select({ id: trainingEnrollments.id })
                .from(trainingEnrollments)
                .where(
                  and(
                    eq(trainingEnrollments.courseId, courseId),
                    eq(trainingEnrollments.personId, people.id),
                    isNull(trainingEnrollments.deletedAt),
                  ),
                ),
            ),
          ),
        )
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (lookup === 'training-skill-assignment-people') {
      const available = or(
        eq(people.status, 'active'),
        input.selected ? eq(people.id, input.selected) : undefined,
      )
      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(
          and(
            or(
              isNull(people.deletedAt),
              input.selected ? eq(people.id, input.selected) : undefined,
            ),
            available,
            personMatch(input),
          ),
        )
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (lookup === 'training-skill-assignment-types') {
      const match = input.hasQuery
        ? or(
            ilike(trainingSkillTypes.name, input.term),
            ilike(trainingSkillTypes.code, input.term),
            ilike(trainingSkillAuthorities.name, input.term),
            input.selected ? eq(trainingSkillTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: trainingSkillTypes.id,
          name: trainingSkillTypes.name,
          code: trainingSkillTypes.code,
          authorityName: trainingSkillAuthorities.name,
        })
        .from(trainingSkillTypes)
        .innerJoin(
          trainingSkillAuthorities,
          eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
        )
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingSkillTypes.id} = ${input.selected}`)] : []),
          asc(trainingSkillAuthorities.name),
          asc(trainingSkillTypes.name),
          asc(trainingSkillTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(row.id, `${row.authorityName} · ${row.code ? `${row.code} · ` : ''}${row.name}`),
        ),
      )
    }

    if (lookup === 'training-class-attendee-candidates') {
      const classId = input.contextId!
      const [trainingClass] = await tx
        .select({ id: trainingClasses.id })
        .from(trainingClasses)
        .where(eq(trainingClasses.id, classId))
        .limit(1)
      if (!trainingClass) return boundPickerOptions([])

      const candidateMatch = input.hasQuery
        ? or(
            personMatch(input),
            ilike(people.email, input.term),
            input.selected ? eq(people.id, input.selected) : undefined,
          )
        : undefined

      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(
          and(
            eq(people.status, 'active'),
            isNull(people.deletedAt),
            candidateMatch,
            notExists(
              tx
                .select({ id: trainingClassAttendees.id })
                .from(trainingClassAttendees)
                .where(
                  and(
                    eq(trainingClassAttendees.classId, classId),
                    eq(trainingClassAttendees.personId, people.id),
                  ),
                ),
            ),
          ),
        )
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (
      lookup === 'training-assessment-people' ||
      lookup === 'training-assessment-types' ||
      lookup === 'training-assessment-courses'
    ) {
      const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
      const visibility = isProctor
        ? undefined
        : await moduleScopeWhere(ctx, tx, {
            prefix: 'training',
            personCol: trainingAssessments.personId,
          })
      const assessmentBase = and(isNull(trainingAssessments.deletedAt), visibility)

      if (lookup === 'training-assessment-people') {
        const rows = await tx
          .select(PERSON_OPTION_SELECTION)
          .from(trainingAssessments)
          .innerJoin(people, eq(people.id, trainingAssessments.personId))
          .where(and(assessmentBase, personMatch(input)))
          .groupBy(people.id, people.firstName, people.lastName, people.employeeNo)
          .orderBy(...personOrder(input.selected))
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(personOptions(rows))
      }

      if (lookup === 'training-assessment-types') {
        const match = input.hasQuery
          ? or(
              ilike(trainingAssessmentTypes.name, input.term),
              input.selected ? eq(trainingAssessmentTypes.id, input.selected) : undefined,
            )
          : undefined
        const rows = await tx
          .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
          .from(trainingAssessments)
          .innerJoin(
            trainingAssessmentTypes,
            eq(trainingAssessmentTypes.id, trainingAssessments.typeId),
          )
          .where(and(assessmentBase, isNull(trainingAssessmentTypes.deletedAt), match))
          .groupBy(trainingAssessmentTypes.id, trainingAssessmentTypes.name)
          .orderBy(
            ...(input.selected
              ? [desc(sql`${trainingAssessmentTypes.id} = ${input.selected}`)]
              : []),
            asc(trainingAssessmentTypes.name),
            asc(trainingAssessmentTypes.id),
          )
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
      }

      const match = input.hasQuery
        ? or(
            ilike(trainingCourses.name, input.term),
            ilike(trainingCourses.code, input.term),
            input.selected ? eq(trainingCourses.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingAssessments)
        .innerJoin(trainingCourses, eq(trainingCourses.id, trainingAssessments.courseId))
        .where(and(assessmentBase, isNull(trainingCourses.deletedAt), match))
        .groupBy(trainingCourses.id, trainingCourses.name, trainingCourses.code)
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingCourses.id} = ${input.selected}`)] : []),
          asc(trainingCourses.code),
          asc(trainingCourses.name),
          asc(trainingCourses.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.code, row.name)))
    }

    if (lookup === 'training-class-courses') {
      const match = input.hasQuery
        ? or(
            ilike(trainingCourses.name, input.term),
            ilike(trainingCourses.code, input.term),
            input.selected ? eq(trainingCourses.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .where(and(isNull(trainingCourses.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${trainingCourses.id} = ${input.selected}`)] : []),
          asc(trainingCourses.name),
          asc(trainingCourses.code),
          asc(trainingCourses.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, `${row.name} (${row.code})`, row.code)),
      )
    }

    if (lookup === 'training-class-sites') {
      const match = input.hasQuery
        ? or(
            ilike(orgUnits.name, input.term),
            ilike(orgUnits.code, input.term),
            input.selected ? eq(orgUnits.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (lookup === 'training-class-instructors') {
      const displayName = sql<string>`coalesce(${tenantUsers.displayName}, ${users.name})`
      const match = input.hasQuery
        ? or(
            ilike(tenantUsers.displayName, input.term),
            ilike(users.name, input.term),
            ilike(users.email, input.term),
            input.selected ? eq(tenantUsers.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.status, 'active'), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${tenantUsers.id} = ${input.selected}`)] : []),
          asc(displayName),
          asc(tenantUsers.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, row.displayName ?? row.name, row.email)),
      )
    }

    if (
      lookup === 'inspection-record-filter-types' ||
      lookup === 'inspection-record-filter-sites' ||
      lookup === 'inspection-record-filter-inspectors'
    ) {
      const scope = await moduleScopeWhere(ctx, tx, {
        prefix: 'inspections',
        ownerCols: [
          inspectionRecords.inspectorTenantUserId,
          inspectionRecords.submittedByTenantUserId,
        ],
        siteCol: inspectionRecords.siteOrgUnitId,
      })

      if (lookup === 'inspection-record-filter-types') {
        const match = input.hasQuery
          ? or(
              ilike(inspectionTypes.name, input.term),
              input.selected ? eq(inspectionTypes.id, input.selected) : undefined,
            )
          : undefined
        const rows = await tx
          .select({ id: inspectionTypes.id, name: inspectionTypes.name })
          .from(inspectionRecords)
          .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
          .where(and(scope, isNull(inspectionRecords.deletedAt), match))
          .groupBy(inspectionTypes.id, inspectionTypes.name)
          .orderBy(
            ...(input.selected ? [desc(sql`${inspectionTypes.id} = ${input.selected}`)] : []),
            asc(inspectionTypes.name),
            asc(inspectionTypes.id),
          )
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
      }

      if (lookup === 'inspection-record-filter-sites') {
        const match = input.hasQuery
          ? or(
              ilike(orgUnits.name, input.term),
              ilike(orgUnits.code, input.term),
              input.selected ? eq(orgUnits.id, input.selected) : undefined,
            )
          : undefined
        const rows = await tx
          .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
          .from(inspectionRecords)
          .innerJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
          .where(and(scope, isNull(inspectionRecords.deletedAt), match))
          .groupBy(orgUnits.id, orgUnits.name, orgUnits.code)
          .orderBy(
            ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
            asc(orgUnits.name),
            asc(orgUnits.id),
          )
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
      }

      const displayName = sql<string>`coalesce(${users.name}, ${tenantUsers.displayName}, ${users.email})`
      const match = input.hasQuery
        ? or(
            ilike(users.name, input.term),
            ilike(tenantUsers.displayName, input.term),
            ilike(users.email, input.term),
            input.selected ? eq(tenantUsers.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(inspectionRecords)
        .innerJoin(tenantUsers, eq(tenantUsers.id, inspectionRecords.inspectorTenantUserId))
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(scope, isNull(inspectionRecords.deletedAt), match))
        .groupBy(tenantUsers.id, tenantUsers.displayName, users.name, users.email)
        .orderBy(
          ...(input.selected ? [desc(sql`${tenantUsers.id} = ${input.selected}`)] : []),
          asc(displayName),
          asc(tenantUsers.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(row.id, row.name ?? row.displayName ?? row.email ?? row.id.slice(0, 8), row.email),
        ),
      )
    }

    if (
      lookup === 'journal-locations' ||
      lookup === 'safe-distance-sites' ||
      lookup === 'location-parent-units' ||
      lookup === 'incident-sites' ||
      lookup === 'inspection-sites' ||
      lookup === 'corrective-action-sites'
    ) {
      const level =
        lookup === 'journal-locations'
          ? 'customer'
          : lookup === 'location-parent-units'
            ? null
            : 'site'
      const match = input.hasQuery
        ? or(
            ilike(orgUnits.name, input.term),
            ilike(orgUnits.code, input.term),
            input.selected ? eq(orgUnits.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          code: orgUnits.code,
          level: orgUnits.level,
        })
        .from(orgUnits)
        .where(
          and(isNull(orgUnits.deletedAt), level ? eq(orgUnits.level, level) : undefined, match),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
          ...(level ? [] : [asc(orgUnits.level)]),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(
            row.id,
            lookup === 'location-parent-units' ? `${row.level}: ${row.name}` : row.name,
            row.code,
          ),
        ),
      )
    }

    if (
      lookup === 'journal-supervisors' ||
      lookup === 'safe-distance-operators' ||
      lookup === 'compliance-by-person' ||
      lookup === 'incident-people' ||
      lookup === 'inspection-people' ||
      lookup === 'document-signoff-people'
    ) {
      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(and(eq(people.status, 'active'), isNull(people.deletedAt), personMatch(input)))
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (
      lookup === 'safe-distance-supervisors' ||
      lookup === 'corrective-action-owners' ||
      lookup === 'management-review-members'
    ) {
      const displayName = sql<string>`coalesce(${tenantUsers.displayName}, ${users.name}, ${users.email})`
      const match = input.hasQuery
        ? or(
            ilike(tenantUsers.displayName, input.term),
            ilike(users.name, input.term),
            ilike(users.email, input.term),
            input.selected ? eq(tenantUsers.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(tenantUsers)
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.status, 'active'), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${tenantUsers.id} = ${input.selected}`)] : []),
          asc(displayName),
          asc(tenantUsers.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(row.id, row.displayName ?? row.name ?? row.email ?? row.id.slice(0, 8), row.email),
        ),
      )
    }

    if (lookup === 'incident-departments') {
      const match = input.hasQuery
        ? or(
            ilike(departments.name, input.term),
            input.selected ? eq(departments.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${departments.id} = ${input.selected}`)] : []),
          asc(departments.name),
          asc(departments.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (lookup === 'incident-classifications') {
      const match = input.hasQuery
        ? or(
            ilike(incidentClassifications.name, input.term),
            ilike(incidentClassifications.code, input.term),
            input.selected ? eq(incidentClassifications.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: incidentClassifications.id,
          name: incidentClassifications.name,
          code: incidentClassifications.code,
        })
        .from(incidentClassifications)
        .where(
          and(
            isNull(incidentClassifications.deletedAt),
            eq(incidentClassifications.isActive, 1),
            match,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${incidentClassifications.id} = ${input.selected}`)] : []),
          asc(incidentClassifications.name),
          asc(incidentClassifications.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (lookup === 'incident-injury-types') {
      const match = input.hasQuery
        ? or(
            ilike(incidentInjuryTypes.name, input.term),
            ilike(incidentInjuryTypes.oshaCode, input.term),
            ilike(incidentInjuryTypes.description, input.term),
            input.selected ? eq(incidentInjuryTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: incidentInjuryTypes.id,
          name: incidentInjuryTypes.name,
          oshaCode: incidentInjuryTypes.oshaCode,
        })
        .from(incidentInjuryTypes)
        .where(
          and(
            isNull(incidentInjuryTypes.deletedAt),
            or(
              eq(incidentInjuryTypes.isActive, 1),
              input.selected ? eq(incidentInjuryTypes.id, input.selected) : undefined,
            ),
            match,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${incidentInjuryTypes.id} = ${input.selected}`)] : []),
          asc(incidentInjuryTypes.sortOrder),
          asc(incidentInjuryTypes.name),
          asc(incidentInjuryTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.oshaCode)))
    }

    if (lookup === 'management-review-documents' || lookup === 'document-book-documents') {
      const match = input.hasQuery
        ? or(
            ilike(documents.title, input.term),
            ilike(documents.key, input.term),
            input.selected ? eq(documents.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: documents.id, title: documents.title, key: documents.key })
        .from(documents)
        .where(
          and(
            isNull(documents.deletedAt),
            lookup === 'document-book-documents' || lookup === 'management-review-documents'
              ? eq(documents.status, 'published')
              : undefined,
            match,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${documents.id} = ${input.selected}`)] : []),
          asc(documents.title),
          asc(documents.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.title, row.key)))
    }

    if (lookup === 'management-review-actions') {
      const match = input.hasQuery
        ? or(
            ilike(correctiveActions.reference, input.term),
            ilike(correctiveActions.title, input.term),
            input.selected ? eq(correctiveActions.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
        })
        .from(correctiveActions)
        .where(and(isNull(correctiveActions.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${correctiveActions.id} = ${input.selected}`)] : []),
          asc(correctiveActions.reference),
          asc(correctiveActions.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => option(row.id, `${row.reference} · ${row.title}`)),
      )
    }

    if (lookup === 'ppe-active-people') {
      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(and(eq(people.status, 'active'), isNull(people.deletedAt), personMatch(input)))
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (lookup === 'ppe-types') {
      const match = input.hasQuery
        ? or(
            ilike(ppeTypes.name, input.term),
            ilike(ppeTypes.category, input.term),
            input.selected ? eq(ppeTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: ppeTypes.id, name: ppeTypes.name, category: ppeTypes.category })
        .from(ppeTypes)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${ppeTypes.id} = ${input.selected}`)] : []),
          asc(ppeTypes.name),
          asc(ppeTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.category)))
    }

    if (lookup === 'vehicle-equipment') {
      const { where } = await resolveVehicleEquipmentWhere(ctx, tx)
      const match = input.hasQuery
        ? or(
            ilike(equipmentItems.assetTag, input.term),
            ilike(equipmentItems.name, input.term),
            input.selected ? eq(equipmentItems.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
        })
        .from(equipmentItems)
        .where(and(where, match))
        .orderBy(
          ...(input.selected ? [desc(sql`${equipmentItems.id} = ${input.selected}`)] : []),
          asc(equipmentItems.assetTag),
          asc(equipmentItems.name),
          asc(equipmentItems.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, `${row.assetTag} · ${row.name}`)))
    }

    if (
      lookup === 'equipment-work-order-filter-assignees' ||
      lookup === 'equipment-work-order-filter-types'
    ) {
      const scope = await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        ownerCols: [
          equipmentWorkOrders.openedByTenantUserId,
          equipmentWorkOrders.assignedToTenantUserId,
        ],
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentWorkOrders.reportedByPersonId,
      })

      if (lookup === 'equipment-work-order-filter-types') {
        const match = input.hasQuery
          ? or(
              ilike(equipmentTypes.name, input.term),
              input.selected ? eq(equipmentTypes.id, input.selected) : undefined,
            )
          : undefined
        const rows = await tx
          .select({ id: equipmentTypes.id, name: equipmentTypes.name })
          .from(equipmentWorkOrders)
          .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
          .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
          .where(and(scope, match))
          .groupBy(equipmentTypes.id, equipmentTypes.name)
          .orderBy(
            ...(input.selected ? [desc(sql`${equipmentTypes.id} = ${input.selected}`)] : []),
            asc(equipmentTypes.name),
            asc(equipmentTypes.id),
          )
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
      }

      const displayName = sql<string>`coalesce(${users.name}, ${tenantUsers.displayName}, ${users.email})`
      const match = input.hasQuery
        ? or(
            ilike(users.name, input.term),
            ilike(tenantUsers.displayName, input.term),
            ilike(users.email, input.term),
            input.selected ? eq(tenantUsers.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(equipmentWorkOrders)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .innerJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(scope, match))
        .groupBy(tenantUsers.id, tenantUsers.displayName, users.name, users.email)
        .orderBy(
          ...(input.selected ? [desc(sql`${tenantUsers.id} = ${input.selected}`)] : []),
          asc(displayName),
          asc(tenantUsers.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(row.id, row.name ?? row.displayName ?? row.email ?? row.id.slice(0, 8), row.email),
        ),
      )
    }

    if (lookup === 'equipment-edit-types' || lookup === 'equipment-edit-categories') {
      if (lookup === 'equipment-edit-types') {
        const match = input.hasQuery
          ? or(
              ilike(equipmentTypes.name, input.term),
              input.selected ? eq(equipmentTypes.id, input.selected) : undefined,
            )
          : undefined
        const rows = await tx
          .select({ id: equipmentTypes.id, name: equipmentTypes.name })
          .from(equipmentTypes)
          .where(match)
          .orderBy(
            ...(input.selected ? [desc(sql`${equipmentTypes.id} = ${input.selected}`)] : []),
            asc(equipmentTypes.name),
            asc(equipmentTypes.id),
          )
          .limit(PICKER_RESULT_LIMIT + 1)
        return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
      }

      const match = input.hasQuery
        ? or(
            ilike(equipmentCategories.name, input.term),
            input.selected ? eq(equipmentCategories.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: equipmentCategories.id, name: equipmentCategories.name })
        .from(equipmentCategories)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${equipmentCategories.id} = ${input.selected}`)] : []),
          asc(equipmentCategories.sortOrder),
          asc(equipmentCategories.name),
          asc(equipmentCategories.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    if (
      lookup === 'equipment-item-inspection-types' ||
      lookup === 'equipment-item-pre-use-inspection-types'
    ) {
      const preUseOnly = lookup === 'equipment-item-pre-use-inspection-types'
      const applicable = input.contextId
        ? or(
            isNull(equipmentInspectionTypes.appliesToTypeId),
            eq(equipmentInspectionTypes.appliesToTypeId, input.contextId),
          )
        : isNull(equipmentInspectionTypes.appliesToTypeId)
      const eligible = and(
        eq(equipmentInspectionTypes.tenantId, ctx.tenantId),
        eq(equipmentInspectionTypes.isActive, true),
        preUseOnly ? eq(equipmentInspectionTypes.isPreUse, true) : undefined,
        applicable,
      )
      const available = or(
        eligible,
        input.selected ? eq(equipmentInspectionTypes.id, input.selected) : undefined,
      )
      const match = input.hasQuery
        ? or(
            ilike(equipmentInspectionTypes.name, input.term),
            ilike(equipmentInspectionTypes.description, input.term),
            input.selected ? eq(equipmentInspectionTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: equipmentInspectionTypes.id,
          name: equipmentInspectionTypes.name,
          intervalValue: equipmentInspectionTypes.intervalValue,
          intervalUnit: equipmentInspectionTypes.intervalUnit,
          isPreUse: equipmentInspectionTypes.isPreUse,
        })
        .from(equipmentInspectionTypes)
        .where(and(available, match))
        .orderBy(
          ...(input.selected
            ? [desc(sql`${equipmentInspectionTypes.id} = ${input.selected}`)]
            : []),
          asc(equipmentInspectionTypes.name),
          asc(equipmentInspectionTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(
            row.id,
            row.name,
            equipmentInspectionTypeHint(row.isPreUse, row.intervalValue, row.intervalUnit),
            {
              kind: 'equipment-inspection-type',
              intervalValue: row.intervalValue,
              intervalUnit: row.intervalUnit,
            },
          ),
        ),
      )
    }

    if (
      lookup === 'equipment-work-order-items' ||
      lookup === 'equipment-reminder-items' ||
      lookup === 'equipment-inspection-items'
    ) {
      const scope = await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentItems.currentHolderPersonId,
      })
      const match = input.hasQuery
        ? or(
            ilike(equipmentItems.assetTag, input.term),
            ilike(equipmentItems.name, input.term),
            input.selected ? eq(equipmentItems.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
          typeId: equipmentItems.typeId,
        })
        .from(equipmentItems)
        .where(
          and(
            isNull(equipmentItems.deletedAt),
            eq(equipmentItems.tenantId, ctx.tenantId),
            lookup === 'equipment-inspection-items' ? eq(equipmentItems.isDraft, false) : undefined,
            lookup === 'equipment-reminder-items' || lookup === 'equipment-inspection-items'
              ? notInArray(equipmentItems.status, ['retired', 'lost'])
              : undefined,
            scope,
            match,
          ),
        )
        .orderBy(
          ...(input.selected ? [desc(sql`${equipmentItems.id} = ${input.selected}`)] : []),
          asc(equipmentItems.assetTag),
          asc(equipmentItems.name),
          asc(equipmentItems.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(
            row.id,
            `${row.assetTag} · ${row.name}`,
            undefined,
            lookup === 'equipment-inspection-items'
              ? { kind: 'equipment-inspection-item', typeId: row.typeId }
              : undefined,
          ),
        ),
      )
    }

    if (lookup === 'vehicle-customers') {
      const match = input.hasQuery
        ? or(
            ilike(orgUnits.name, input.term),
            ilike(orgUnits.code, input.term),
            input.selected ? eq(orgUnits.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'customer'), isNull(orgUnits.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (
      lookup === 'vehicle-drivers' ||
      lookup === 'equipment-custody-holders' ||
      lookup === 'equipment-reminder-assignees' ||
      lookup === 'equipment-work-order-reporters'
    ) {
      const rows = await tx
        .select(PERSON_OPTION_SELECTION)
        .from(people)
        .where(and(eq(people.status, 'active'), isNull(people.deletedAt), personMatch(input)))
        .orderBy(...personOrder(input.selected))
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(personOptions(rows))
    }

    if (lookup === 'equipment-custody-sites') {
      const match = input.hasQuery
        ? or(
            ilike(orgUnits.name, input.term),
            ilike(orgUnits.code, input.term),
            input.selected ? eq(orgUnits.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
    }

    if (lookup === 'equipment-work-order-assignees') {
      const displayName = sql<string>`coalesce(${users.name}, ${tenantUsers.displayName}, ${users.email})`
      const match = input.hasQuery
        ? or(
            ilike(users.name, input.term),
            ilike(tenantUsers.displayName, input.term),
            ilike(users.email, input.term),
            input.selected ? eq(tenantUsers.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(tenantUsers)
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.status, 'active'), match))
        .orderBy(
          ...(input.selected ? [desc(sql`${tenantUsers.id} = ${input.selected}`)] : []),
          asc(displayName),
          asc(tenantUsers.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) =>
          option(row.id, row.name ?? row.displayName ?? row.id.slice(0, 6), row.email),
        ),
      )
    }

    if (lookup === 'equipment-types') {
      const match = input.hasQuery
        ? or(
            ilike(equipmentTypes.name, input.term),
            input.selected ? eq(equipmentTypes.id, input.selected) : undefined,
          )
        : undefined
      const rows = await tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .where(match)
        .orderBy(
          ...(input.selected ? [desc(sql`${equipmentTypes.id} = ${input.selected}`)] : []),
          asc(equipmentTypes.name),
          asc(equipmentTypes.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(rows.map((row) => option(row.id, row.name)))
    }

    const match = input.hasQuery
      ? or(
          ilike(incidentClassifications.name, input.term),
          ilike(incidentClassifications.code, input.term),
          input.selected ? eq(incidentClassifications.id, input.selected) : undefined,
        )
      : undefined
    const rows = await tx
      .select({
        id: incidentClassifications.id,
        name: incidentClassifications.name,
        code: incidentClassifications.code,
      })
      .from(incidentClassifications)
      .where(
        and(
          isNull(incidentClassifications.parentId),
          isNull(incidentClassifications.deletedAt),
          eq(incidentClassifications.isActive, 1),
          match,
        ),
      )
      .orderBy(
        ...(input.selected ? [desc(sql`${incidentClassifications.id} = ${input.selected}`)] : []),
        asc(incidentClassifications.name),
        asc(incidentClassifications.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)
    return boundPickerOptions(rows.map((row) => option(row.id, row.name, row.code)))
  })
}
