# Tenant relational integrity audit

## Outcome

BeaconHS row-level security correctly restricts rows by `tenant_id`, but RLS is
not a relational-integrity boundary. PostgreSQL explicitly bypasses row security
while performing internal referential-integrity checks. A child row whose
`tenant_id` is tenant A can therefore satisfy a conventional `parent_id ->
parent.id` foreign key with a parent row owned by tenant B.

UUID primary keys make accidental collisions implausible, but they do not make
the relationship safe once a foreign UUID is known through an import, an
integration, a privileged process, a support operation, or a programming bug.
The database must compare both tenant and id.

The audit introspected all 203 current Drizzle tables and every declared foreign
key. It found 315 tenant-child to tenant-parent relationships in Drizzle, plus
42 attachment columns governed by the explicit raw-migration manifest:

- 41 are represented by composite `(tenant_id, parent_id)` Drizzle foreign keys.
- 274 residual single-column relationships remain in the exact, executable
  snapshot at
  `packages/db/src/__snapshots__/tenant-relational-integrity.test.ts.snap`.
- 42 attachment relationships are represented only by composite constraints
  generated from `packages/db/src/attachment-integrity.ts`; Drizzle intentionally
  declares no redundant `attachment_id -> attachments.id` foreign keys.

The snapshot is a ratchet. Adding, removing, or retargeting one of those 274
relationships fails the database tests until the edge is reviewed. Attachment
references have their own exhaustive manifest test. It proves that every
attachment-id column appears exactly once, none regresses to a single-column
foreign key, and every raw constraint has bounded naming plus the correct
composite key and delete action.

## Completed critical conversions

The following authorization and data-sharing boundaries are composite in the
Drizzle schema now:

- role assignment -> tenant membership
- role assignment -> role
- permission override -> tenant membership
- role dashboard default -> role
- AI message -> conversation
- AI conversation share -> conversation
- AI conversation role share -> role
- AI conversation user share -> active tenant membership identity
- API idempotency record -> API key
- domain event effect -> outbox event
- integration export log -> tenant automation
- form response -> submitter and locking tenant memberships
- form workflow check-in and comment -> acting tenant membership
- form workflow step -> assignee, signer, and rejector tenant memberships
- flow gate -> assignee and deciding tenant memberships
- data source -> creator membership and data row -> source
- sync crosswalk/run/change ledgers -> connection and run
- notification group member -> notification group
- compliance audience, dispatch, and status -> obligation
- compliance status -> person and obligation -> creator membership
- form, inspection, and journal durable dispatch -> assignment
- inspection assignment materialized status -> assignment and person
- report schedule -> run-as membership and role (pre-existing in this audit)
- report run -> schedule and report delivery -> run (pre-existing in this audit)

AI shares also enforce exactly one correctly typed target, use partial unique
indexes to prevent duplicate shares under concurrency, and insert with conflict
handling rather than a check-then-insert race.

## Ranked residual conversion batches

| Rank | Residual edges | Scope                                                         |
| ---- | -------------: | ------------------------------------------------------------- |
| P1   |            125 | tenant identity, person identity, and org-unit visibility     |
| P2   |             73 | operational aggregate ownership and child records             |
| P3   |             76 | taxonomies, leaf relationships, and reviewed hybrid semantics |
|      |        **274** | exact current residual ratchet                                |

### P0: finish before production data is accepted

The 42 attachment links are security-sensitive because they can expose private
objects or signatures. Their canonical model is composite-only: the cutover
migration installs and validates the manifest constraints, while the Drizzle
schema emits no parallel simple constraints. Do not reintroduce a second
foreign key for the same logical relationship.

The direct critical conversions above must be included in the same generated
migration and validated against existing data before deployment.

### P1: identity, visibility, and tenant scope

These hubs carry most of the remaining exposure and should be converted next:

| Parent         | Residual edges | Why it is high impact                                                |
| -------------- | -------------: | -------------------------------------------------------------------- |
| `tenant_users` |             58 | owners, assignees, approvers, submitters, and audit actors           |
| `people`       |             43 | subject identity, training, signatures, injury, and assignment scope |
| `org_units`    |             24 | site/department visibility and operational scope                     |

The exact children and columns are in the committed snapshot. Convert one hub
at a time so preflight failures identify the responsible domain precisely.

### Reviewed hybrid relationships

Some high-value relationships cannot be converted mechanically without changing
product semantics:

- `report_schedules.definition_id` may target either a global built-in report
  definition (`tenant_id IS NULL`) or a tenant-owned custom definition. A plain
  composite tenant FK would reject every valid built-in schedule.
- API-key creators, audit actors, notification recipients, preferences, and push
  subscriptions currently retain global user identity. Retargeting them to a
  `tenant_users` membership would change what happens when membership is removed,
  including whether audit/notification history is retained or cascaded. Decide
  that lifecycle explicitly before changing those parents.

### P2: aggregate ownership

Convert the major aggregate roots and their children in bounded domain batches:

| Parent                                 | Residual edges |
| -------------------------------------- | -------------: |
| `training_courses`                     |              9 |
| `equipment_items`                      |              8 |
| `incidents`                            |              8 |
| `form_templates`                       |              7 |
| `hazid_assessments`                    |              7 |
| `documents`                            |              6 |
| `form_responses`                       |              6 |
| equipment inspection roots             |              9 |
| inspection roots                       |             10 |
| compliance and corrective-action roots |              3 |

### P3: taxonomies and leaf relationships

The remaining 76 edges are spread across classifications, categories, groups,
types, assignments, sync metadata, and other low-fan-out parents. They are not
exempt from tenant integrity; they are last only because they have less direct
authorization and visibility impact. The snapshot is the authoritative list.

## Cutover migration design

For every residual edge `child(tenant_id, parent_id) -> parent(tenant_id, id)`:

1. Abort if any existing relationship crosses tenants. Do not silently rewrite
   ownership:

   ```sql
   SELECT child.id, child.tenant_id, parent.tenant_id AS parent_tenant_id
   FROM child
   JOIN parent ON parent.id = child.parent_id
   WHERE child.parent_id IS NOT NULL
     AND child.tenant_id IS DISTINCT FROM parent.tenant_id;
   ```

2. Add a unique parent key on `(tenant_id, id)`. PostgreSQL requires the
   referenced column set to be backed by an exact primary key, unique
   constraint, or non-partial unique index.
3. Add the composite foreign key as `NOT VALID`, preserving the existing delete
   behavior, then run `VALIDATE CONSTRAINT`.
4. Drop the original single-column foreign key in the same cutover. A permanent
   duplicate FK adds write cost and obscures the canonical invariant.
5. Keep an index beginning with the child `tenant_id` and relationship column
   where deletes or joins need it.

For nullable child references, PostgreSQL `MATCH SIMPLE` correctly skips the
parent lookup when `parent_id` is null. For `ON DELETE SET NULL`, use PostgreSQL
16's column-list form:

```sql
FOREIGN KEY (tenant_id, parent_id)
  REFERENCES parent (tenant_id, id)
  ON DELETE SET NULL (parent_id)
```

Without `(parent_id)`, PostgreSQL would also null `tenant_id`, violating the
child's required tenant ownership. Drizzle does not currently express this
column-list delete action, so those constraints need reviewed raw migration DDL
and an explicit manifest test.

## Verification gates

- `pnpm --filter @beaconhs/db typecheck`
- `pnpm --filter @beaconhs/db test`
- Restore the current dev backup into a disposable PostgreSQL 16 cluster.
- Run every cross-tenant preflight query and require zero rows.
- Apply the generated migration.
- Query `pg_constraint` to require every manifest constraint to be present and
  validated (`convalidated = true`).
- Prove a same-tenant insert succeeds and a cross-tenant insert fails for each
  conversion batch.
- Dump and restore the migrated database to prove constraint ordering and
  schema completeness.

Primary references: [PostgreSQL row-security
documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) and
[PostgreSQL foreign-key documentation](https://www.postgresql.org/docs/16/ddl-constraints.html).
