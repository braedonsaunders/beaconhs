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

The audit introspects all 196 current Drizzle tables and every declared foreign
key. After the PPE cutover in migration `0018`, it finds 279
tenant-child-to-tenant-parent relationships in Drizzle, plus 42 attachment
columns governed by the explicit raw-migration manifest:

- 257 are represented by composite `(tenant_id, parent_id)` Drizzle foreign keys.
- 22 residual single-column relationships remain in the exact, executable
  snapshot at
  `packages/db/src/__snapshots__/tenant-relational-integrity.test.ts.snap`.
- 42 attachment relationships are represented only by composite constraints
  generated from `packages/db/src/attachment-integrity.ts`; Drizzle intentionally
  declares no redundant `attachment_id -> attachments.id` foreign keys.

The snapshot is a ratchet. Adding, removing, or retargeting one of those 22
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
- People group membership -> person and People group
- compliance audience, dispatch, and status -> obligation
- compliance status -> person and obligation -> creator membership
- report schedule -> run-as membership and role (pre-existing in this audit)
- report run -> schedule and report delivery -> run (pre-existing in this audit)
- Builder form ownership and response/workflow children (migration `0006`)
- HazID assessment, task, question, PPE, photo, signature, and Builder links
  (migrations `0007` and `0008`)
- equipment, custody, inspection, work-order, reminder, and vehicle-log links
  (migration `0009`)
- document, version, acknowledgment, review, exact-version book, and category
  links (squashed into the production cutover migration)
- incident, investigation, injury, taxonomy, hours, people, and source-form
  links (migration `0013`)
- all 42 live training course, class, record, assessment, LMS, skill, and exact
  assessment-to-compliance links (the retired audience-assignment family is excluded)
- all 18 current inspection type, bank, record, criteria, and principal links
  (migration `0016`, excluding the retired legacy assignment edge)
- all 19 declared people, org hierarchy, workforce taxonomy, group, title,
  contact, kiosk, file, and job-task links (migration `0017`)
- all 15 declared PPE inventory, issue, inspection, annual-record, criteria-bank,
  and type-criteria links (migration `0018`)

AI shares also enforce exactly one correctly typed target, use partial unique
indexes to prevent duplicate shares under concurrency, and insert with conflict
handling rather than a check-then-insert race.

## Ranked residual conversion batches

The post-`0018` executable ratchet contains exactly 22 edges. This domain split
is mutually exclusive and therefore sums to the ratchet total:

| Rank | Residual edges | Child domain                                                    |
| ---- | -------------: | --------------------------------------------------------------- |
| P2   |              7 | journals: entries, photos, tags, sites, people, and principals  |
| P2   |              7 | corrective actions: owners, verifiers, steps, photos, and sites |
| P2   |              8 | remaining templates, reports, insights, and safe-distance links |
|      |         **22** | exact current residual ratchet                                  |

The highest-fan-out remaining parents are `tenant_users` (9 edges), `people`
(3), and `org_units` (3). Together those hubs account for 15 of the 22 residual
relationships, but they cut across the domain batches above and must not be
added to those totals a second time.

### P0: keep complete before production data is accepted

The 42 attachment links are security-sensitive because they can expose private
objects or signatures. Their canonical model is composite-only: the cutover
migration installs and validates the manifest constraints, while the Drizzle
schema emits no parallel simple constraints. Do not reintroduce a second
foreign key for the same logical relationship.

Each remaining domain must use the same fail-closed cutover pattern already
proven by forms, HazID, equipment, documents, incidents, training, inspections,
people/org, and PPE: visible all-tenant preflight, FORCE-RLS restoration before
durable DDL, validated replacement keys, then legacy-key removal.

### Reviewed hybrid relationship

`report_schedules.definition_id` may target either a global built-in report
definition (`tenant_id IS NULL`) or a tenant-owned custom definition. A plain
composite tenant FK would reject every valid built-in schedule. Its final
cutover needs an explicit hybrid invariant rather than a mechanical composite
key. It remains in the ratchet until that invariant is implemented and tested.

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
