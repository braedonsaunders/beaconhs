// Canonical job-title projection for person-facing queries.
//
// A person may hold several titles, but exactly one assignment may be primary.
// Consumers that need the familiar single "job title" label must read that
// relationship instead of the retired people.job_title shadow column. Keeping
// the correlated lookup here gives search, reports, PDFs, APIs, and pickers the
// same primary-only and soft-delete semantics without multiplying result rows.

import { getTableName, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { personTitleAssignments, personTitles } from './schema'

// Render a column as an explicitly table-qualified raw identifier. Interpolating
// Column objects is not safe here: when this fragment is embedded in the field
// list of a single-table select, Drizzle rewrites every Column chunk to a bare
// unqualified name, which is ambiguous inside the correlated subquery (42702).
function qualified(column: AnyColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`)
}

/**
 * Return the active primary title name for a person, or null when none exists.
 * Both columns should come from the person row in the surrounding query. The
 * tenant predicate is intentional defense-in-depth even though composite FKs
 * and RLS already prevent a cross-tenant assignment.
 */
export function primaryPersonTitleName(
  personId: AnyColumn,
  tenantId: AnyColumn,
): SQL<string | null> {
  return sql<string | null>`(
    SELECT ${qualified(personTitles.name)}
    FROM ${personTitleAssignments}
    INNER JOIN ${personTitles}
      ON ${qualified(personTitles.id)} = ${qualified(personTitleAssignments.titleId)}
      AND ${qualified(personTitles.tenantId)} = ${qualified(personTitleAssignments.tenantId)}
    WHERE ${qualified(personTitleAssignments.personId)} = ${qualified(personId)}
      AND ${qualified(personTitleAssignments.tenantId)} = ${qualified(tenantId)}
      AND ${qualified(personTitleAssignments.isPrimary)} = true
      AND ${qualified(personTitles.deletedAt)} IS NULL
    LIMIT 1
  )`
}
