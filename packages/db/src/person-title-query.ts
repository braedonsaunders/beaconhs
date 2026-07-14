// Canonical job-title projection for person-facing queries.
//
// A person may hold several titles, but exactly one assignment may be primary.
// Consumers that need the familiar single "job title" label must read that
// relationship instead of the retired people.job_title shadow column. Keeping
// the correlated lookup here gives search, reports, PDFs, APIs, and pickers the
// same primary-only and soft-delete semantics without multiplying result rows.

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { personTitleAssignments, personTitles } from './schema'

/**
 * Return the active primary title name for a person, or null when none exists.
 * Both columns should come from the person row in the surrounding query. The
 * tenant predicate is intentional defense-in-depth even though composite FKs
 * and RLS already prevent a cross-tenant assignment.
 */
export function primaryPersonTitleName(
  personId: SQLWrapper,
  tenantId: SQLWrapper,
): SQL<string | null> {
  return sql<string | null>`(
    SELECT ${personTitles.name}
    FROM ${personTitleAssignments}
    INNER JOIN ${personTitles}
      ON ${personTitles.id} = ${personTitleAssignments.titleId}
      AND ${personTitles.tenantId} = ${personTitleAssignments.tenantId}
    WHERE ${personTitleAssignments.personId} = ${personId}
      AND ${personTitleAssignments.tenantId} = ${tenantId}
      AND ${personTitleAssignments.isPrimary} = true
      AND ${personTitles.deletedAt} IS NULL
    LIMIT 1
  )`
}
