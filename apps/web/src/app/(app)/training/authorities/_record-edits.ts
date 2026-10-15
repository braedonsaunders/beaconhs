// The `training-authorities` record saver: the inline company / account number
// on a skill authority, queued on the device by the authority page and applied
// by /api/records/sync (see lib/record-sync). Training module managers only;
// the edit is audited with its before and after value, plus a compare-and-set
// against the value the device last saw.

import { and, eq } from 'drizzle-orm'
import { trainingSkillAuthorities } from '@beaconhs/db/schema'
import { canManageModule } from '@/lib/module-admin/guard'
import { optionalTextInput } from '@/lib/mutation-input'
import { columnOps } from '@/lib/record-sync/codecs'
import { auditFieldChanges, defineRecordSaver, recordNotFound } from '@/lib/record-sync/edits'

type AuthorityRow = typeof trainingSkillAuthorities.$inferSelect

export const trainingAuthorityRecordSaver = defineRecordSaver<AuthorityRow>(
  'training-authorities',
  {
    authorize: (ctx) => canManageModule(ctx, 'training'),
    async load(tx, ctx, authorityId) {
      // Authorities are hard-deleted (there is no soft-delete column), so a
      // missing row is the only "gone" state.
      const [row] = await tx
        .select()
        .from(trainingSkillAuthorities)
        .where(
          and(
            eq(trainingSkillAuthorities.id, authorityId),
            eq(trainingSkillAuthorities.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
        .for('update')
      if (!row) throw recordNotFound()
      return row
    },
    resolve: (tx, ctx, row, op) =>
      columnOps(
        row,
        {
          accountNumber: {
            parse: (wire) => optionalTextInput(wire, 'Company / account number', 200),
            format: (value) => value ?? '',
          },
        },
        (patch) =>
          tx
            .update(trainingSkillAuthorities)
            .set(patch)
            .where(
              and(
                eq(trainingSkillAuthorities.id, row.id),
                eq(trainingSkillAuthorities.tenantId, ctx.tenantId),
              ),
            ),
      )(op),
    afterWrites: (tx, ctx, row, changes) =>
      auditFieldChanges(
        tx,
        ctx,
        { entityType: 'training_skill_authority', entityId: row.id },
        changes,
        () => ({ summary: 'Updated company / account number' }),
      ),
    revalidate: (authorityId) => [`/training/authorities/${authorityId}`],
  },
)
