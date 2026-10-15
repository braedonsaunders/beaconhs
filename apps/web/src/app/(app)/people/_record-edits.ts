// The `people` record saver: inline edits on a person's page, queued on the
// device and applied by /api/records/sync (see lib/record-sync). Same rules
// the inline editors have always had — the people-module manage permission,
// the directory's sync lock (an actively synced person's identity fields and
// title assignments belong to the source system), required names, an active
// manager who is not the person themself, one audit entry per change, and the
// compliance audience refresh when status / department / trade / location move — plus a
// compare-and-set against the value the device last saw.
//
// Ops: person columns by name, `groups` and `titles` (the full selected id
// lists), `primaryTitleId`, and `custom:<key>` custom fields.

import { and, eq, isNull } from 'drizzle-orm'
import { activePeopleWhere, isUniqueViolation, type Database } from '@beaconhs/db'
import {
  orgUnits,
  people,
  personGroupMemberships,
  personGroups,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { materializeIdentityAudienceObligations } from '@beaconhs/compliance'
import { entityConfig } from '@/lib/custom-fields/config'
import { customFieldRecordOp, isCustomFieldOp } from '@/lib/custom-fields/record-op'
import { canManageModule } from '@/lib/module-admin/guard'
import { SYNC_OWNED_PERSON_FIELDS, getPersonSyncOrigin } from '@/lib/people-sync'
import { lockPersonGroupMembershipGraph } from '@/lib/person-group-memberships'
import {
  choice,
  columnOps,
  optionalDate,
  optionalRef,
  optionalRichText,
  optionalText,
  requiredText,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  auditFieldChanges,
  defineRecordSaver,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
  type RecordOp,
} from '@/lib/record-sync/edits'
import { orderIdsByName, parseIdList } from './_lib/assignment-order'
import {
  setPersonGroupMemberships,
  setPersonTitleAssignments,
  setPrimaryPersonTitleAssignment,
} from './_lib/person-assignments'

type PersonRow = typeof people.$inferSelect
type LoadedPerson = { row: PersonRow; synced: boolean }

const PERSON_STATUSES = ['active', 'inactive', 'terminated'] as const

/** Identity fields the source system owns while the person is synced. */
const SYNC_OWNED_FIELDS = new Set<string>(SYNC_OWNED_PERSON_FIELDS)
/** Ops that audit themselves (relationships and custom fields). */
const RELATIONSHIP_OPS = new Set(['groups', 'titles', 'primaryTitleId'])
const COMPLIANCE_AUDIENCE_FIELDS = new Set([
  'status',
  'departmentId',
  'tradeId',
  'locationOrgUnitId',
])
const EMPLOYEE_NO_UNIQUE = 'people_tenant_employee_no_ux'

function personCodecs(personId: string): { [K in keyof PersonRow]?: Codec<PersonRow[K]> } {
  const manager = optionalRef({ label: 'Reports to' })
  return {
    firstName: requiredText({ label: 'First name' }),
    lastName: requiredText({ label: 'Last name' }),
    formalName: optionalText({ label: 'Formal name' }),
    employeeNo: optionalText({ label: 'Employee #' }),
    email: optionalText({ label: 'Email' }),
    phone: optionalText({ label: 'Phone' }),
    externalEmployeeId: optionalText({ label: 'External employee ID' }),
    emergencyContactName: optionalText({ label: 'Contact name' }),
    emergencyContactPhone: optionalText({ label: 'Contact phone' }),
    notes: optionalRichText({ label: 'Notes' }),
    status: choice(PERSON_STATUSES, { label: 'Status' }),
    dateOfBirth: optionalDate({ label: 'Date of birth' }),
    hireDate: optionalDate({ label: 'Hire date' }),
    terminationDate: optionalDate({ label: 'Termination date' }),
    departmentId: optionalRef({ label: 'Department' }),
    tradeId: optionalRef({ label: 'Trade' }),
    crewId: optionalRef({ label: 'Crew' }),
    locationOrgUnitId: optionalRef({ label: 'Location' }),
    managerPersonId: {
      parse: (wire) => {
        const value = manager.parse(wire)
        if (value === personId) {
          throw new RecordEditRejection('A person cannot be their own manager.')
        }
        return value
      },
      format: manager.format,
    },
  }
}

/** The op as it is, except that every submitted value is refused with `message`. */
function refused(op: ErasedRecordOp, message: string): ErasedRecordOp {
  const inner = op as unknown as RecordOp<unknown>
  return recordOp<unknown>({
    ...inner,
    parse: () => {
      throw new RecordEditRejection(message)
    },
  })
}

async function personColumnUpdate(
  tx: Database,
  ctx: RequestContext,
  row: PersonRow,
  patch: Partial<PersonRow>,
): Promise<void> {
  if (patch.managerPersonId) {
    const [manager] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          eq(people.id, patch.managerPersonId),
          activePeopleWhere(),
        ),
      )
      .limit(1)
    if (!manager) throw new RecordEditRejection('Choose an active manager')
  }
  if (patch.locationOrgUnitId) {
    const [location] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.tenantId, ctx.tenantId),
          eq(orgUnits.id, patch.locationOrgUnitId),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (!location) throw new RecordEditRejection('Choose an existing location')
  }
  try {
    await tx
      .update(people)
      .set(patch)
      .where(
        and(eq(people.id, row.id), eq(people.tenantId, ctx.tenantId), isNull(people.deletedAt)),
      )
  } catch (error) {
    if (isUniqueViolation(error, EMPLOYEE_NO_UNIQUE)) {
      throw new RecordEditRejection('Another person already uses this employee number.')
    }
    throw error
  }
}

/** Live catalogue names, for ordering the Groups / Titles chips. */
async function groupNames(tx: Database): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: personGroups.id, name: personGroups.name })
    .from(personGroups)
    .where(isNull(personGroups.deletedAt))
  return new Map(rows.map((row) => [row.id, row.name]))
}

async function titleNames(tx: Database): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: personTitles.id, name: personTitles.name })
    .from(personTitles)
    .where(isNull(personTitles.deletedAt))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** Groups the person belongs to, as the page shows them (live groups only). */
async function heldGroupIds(tx: Database, personId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: personGroupMemberships.groupId })
    .from(personGroupMemberships)
    .innerJoin(personGroups, eq(personGroups.id, personGroupMemberships.groupId))
    .where(and(eq(personGroupMemberships.personId, personId), isNull(personGroups.deletedAt)))
  return rows.map((row) => row.id)
}

/** Titles the person holds, as the page shows them (live titles only). */
async function heldTitles(
  tx: Database,
  personId: string,
): Promise<Array<{ id: string; isPrimary: boolean }>> {
  return tx
    .select({ id: personTitleAssignments.titleId, isPrimary: personTitleAssignments.isPrimary })
    .from(personTitleAssignments)
    .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
    .where(and(eq(personTitleAssignments.personId, personId), isNull(personTitles.deletedAt)))
}

function idListOp(
  current: string[],
  names: Map<string, string>,
  write: (ids: string[]) => Promise<void>,
): ErasedRecordOp {
  return recordOp<string[]>({
    current,
    parse: parseIdList,
    format: (ids) => orderIdsByName(ids, names),
    write,
  })
}

export const personRecordSaver = defineRecordSaver<LoadedPerson>('people', {
  authorize: (ctx) => canManageModule(ctx, 'people'),
  async load(tx, ctx, personId) {
    // Every membership writer takes the tenant's group-graph lock before it
    // locks people rows; take it first here too so the two never deadlock.
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [row] = await tx
      .select()
      .from(people)
      .where(
        and(eq(people.tenantId, ctx.tenantId), eq(people.id, personId), isNull(people.deletedAt)),
      )
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    return { row, synced: (await getPersonSyncOrigin(tx, personId)) !== null }
  },
  async resolve(tx, ctx, { row, synced }, op) {
    if (isCustomFieldOp(op)) {
      const custom = await customFieldRecordOp(tx, ctx, {
        kind: 'person',
        recordId: row.id,
        record: row,
        op,
      })
      // Custom-field values also need the custom-field permission for people.
      if (!custom || can(ctx, entityConfig('person').permission)) return custom
      return refused(custom, 'You do not have permission to edit this field.')
    }
    if (op === 'groups') {
      const [names, current] = await Promise.all([groupNames(tx), heldGroupIds(tx, row.id)])
      return idListOp(orderIdsByName(current, names), names, (ids) =>
        setPersonGroupMemberships(tx, ctx, row.id, ids),
      )
    }
    if (op === 'titles') {
      const [names, held] = await Promise.all([titleNames(tx), heldTitles(tx, row.id)])
      const titles = idListOp(
        orderIdsByName(
          held.map((title) => title.id),
          names,
        ),
        names,
        (ids) => setPersonTitleAssignments(tx, ctx, row.id, ids),
      )
      return synced
        ? refused(titles, 'Title assignments are managed by an external sync and are read-only')
        : titles
    }
    if (op === 'primaryTitleId') {
      const held = await heldTitles(tx, row.id)
      const codec = optionalRef({ label: 'Primary job title' })
      const primary = recordOp<string | null>({
        current: held.find((title) => title.isPrimary)?.id ?? null,
        parse: codec.parse,
        format: codec.format,
        write: (titleId) => setPrimaryPersonTitleAssignment(tx, ctx, row.id, titleId),
      })
      return synced
        ? refused(primary, 'Primary job title is managed by an external sync and is read-only')
        : primary
    }
    const column = columnOps(row, personCodecs(row.id), (patch) =>
      personColumnUpdate(tx, ctx, row, patch),
    )(op)
    if (column && synced && SYNC_OWNED_FIELDS.has(op)) {
      return refused(column, 'Field is managed by an external sync and is read-only')
    }
    return column
  },
  async afterWrites(tx, ctx, { row }, changes) {
    const columnChanges = changes.filter(
      (change) => !isCustomFieldOp(change.op) && !RELATIONSHIP_OPS.has(change.op),
    )
    if (columnChanges.some((change) => COMPLIANCE_AUDIENCE_FIELDS.has(change.op))) {
      await materializeIdentityAudienceObligations(tx, ctx.tenantId, [row.id])
    }
    await auditFieldChanges(
      tx,
      ctx,
      { entityType: 'person', entityId: row.id },
      columnChanges,
      (change) => ({ summary: `Person ${change.op} updated` }),
    )
  },
  // The name, status, and primary title also show on the directory and the
  // org chart.
  revalidate: (personId) => [`/people/${personId}`, '/people', '/people/org-chart'],
})
