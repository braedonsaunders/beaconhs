// Field ids for the edits a criterion card queues on the device (see
// lib/offline-drafts/offline-record): `criteria:<rowId>:<field>`. The card
// builds them; the module's record saver parses them back and resolves the
// row against the locked parent record. Shared by site and equipment
// inspections.

import { parseRowFieldId, rowFieldId } from '@/lib/offline-drafts/field-ids'

export function criterionFieldId(rowId: string, field: string): string {
  return rowFieldId('criteria', rowId, field)
}

/** The row and field of a criterion field id, or null when it is not one of `fields`. */
export function parseCriterionFieldId<const F extends string>(
  fieldId: string,
  fields: readonly F[],
): { rowId: string; field: F } | null {
  const parsed = parseRowFieldId(fieldId, { criteria: fields })
  return parsed ? { rowId: parsed.rowId, field: parsed.field } : null
}

/** A site-inspection finding's assignment, edited as one field. */
export type CriterionAssignmentWire = { assignedToPersonId: string; assignedDueDate: string }

export function criterionAssignmentWire(
  personId: string | null,
  dueDate: string | null,
): CriterionAssignmentWire {
  return { assignedToPersonId: personId ?? '', assignedDueDate: dueDate ?? '' }
}
