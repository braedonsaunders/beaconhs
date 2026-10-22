import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => currentCtx }))
import { eq, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  people,
  users,
  tenantUsers,
  hazidAssessments,
  hazidAssessmentSignatures,
  hazidAssessmentQuestions,
  hazidSigningRounds,
  attachments,
  auditLog,
  hazidHazards,
  hazidHazardSets,
  formTemplates,
  formTemplateVersions,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { loadOwnSigningRequest } from './hazid-signing-request'
import { loadSigningHistory, loadSignedVersion } from './hazid-signing-history'
import { requireOwnHazidSignature } from './hazid-signing'
import { openCurrentSigningRequest } from '@/app/(app)/hazard-assessments/sign/[signatureId]/_actions'
const url = process.env.MIGRATION_DATABASE_URL!
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
  throw Error('Isolated database required')
let currentCtx: RequestContext
it('preserves reorder signatures, recovers stale requests only for their owner, and publishes tenant-scoped config without rewriting evidence', async () => {
  const c = createClient({ url, max: 1 }),
    tenantId = '362623eb-f615-4610-b2f9-3422dde18cf4',
    foreign = randomUUID(),
    userId = randomUUID(),
    personId = randomUUID(),
    membership = randomUUID(),
    assessmentId = randomUUID(),
    signatureId = randomUUID(),
    questionId = randomUUID(),
    attachmentId = randomUUID(),
    hazardId = randomUUID(),
    setId = randomUUID(),
    templateId = randomUUID(),
    versionId = randomUUID()
  const rollback = new Error('Test rollback')
  try {
    await expect(
      withTenant(c.db, tenantId, async (tx) => {
        const owner = process.env.DATABASE_OWNER_ROLE
        if (!owner) throw Error('DATABASE_OWNER_ROLE required')
        await tx.execute(sql`set local role ${sql.identifier(owner)}`)
        await tx.insert(tenants).values([
          { id: tenantId, slug: 'rassaun', name: 'Isolated Rassaun' },
          { id: foreign, slug: foreign, name: 'Other QA' },
        ])
        await tx
          .insert(users)
          .values({ id: userId, name: 'Signer QA', email: `${userId}@example.test` })
        await tx.insert(tenantUsers).values({ id: membership, tenantId, userId })
        await tx
          .insert(people)
          .values({ id: personId, tenantId, userId, firstName: 'Signer', lastName: 'QA' })
        await tx.insert(attachments).values({
          id: attachmentId,
          tenantId,
          kind: 'signature',
          r2Key: `t/${tenantId}/qa/signature.png`,
          contentType: 'image/png',
          sizeBytes: 68,
          filename: 'signature.png',
        })
        await tx.insert(hazidHazards).values({ id: hazardId, tenantId, name: 'Welding' })
        await tx
          .insert(hazidHazardSets)
          .values({ id: setId, tenantId, name: 'Standard Mechanical Hazards', hazardIds: [] })
        const schema = {
          schemaVersion: 1 as const,
          title: { en: 'Fall protection' },
          workflow: {
            steps: [
              {
                key: 'submit',
                title: { en: 'Submit' },
                assignee: { type: 'expression' as const, expr: '$submitter' },
              },
            ],
          },
          sections: [
            {
              id: 'main',
              title: { en: 'Equipment' },
              fields: [
                {
                  id: 'equipment',
                  type: 'multi_select' as const,
                  label: { en: 'Fall-protection equipment' },
                  validation: { options: [{ value: 'rescue', label: { en: 'Rescue Ladder' } }] },
                },
              ],
            },
          ],
        }
        await tx.insert(formTemplates).values({
          id: templateId,
          tenantId,
          key: 'hazid-fall-protection-plan',
          name: 'Fall Protection Plan',
          status: 'published',
        })
        await tx.insert(formTemplateVersions).values({
          id: versionId,
          tenantId,
          templateId,
          version: 1,
          schema,
          publishedAt: new Date(),
        })
        const migration = readFileSync(
          '../../packages/db/drizzle/0084_hazard_signing_usability.sql',
          'utf8',
        )
        await tx.execute(sql.raw(migration))
        await tx.execute(sql.raw(migration))
        const versions = await tx
          .select()
          .from(formTemplateVersions)
          .where(eq(formTemplateVersions.templateId, templateId))
          .orderBy(formTemplateVersions.version)
        expect(versions).toHaveLength(2)
        expect(versions[0]!.schema).toEqual(schema)
        expect(versions[1]!.schema.sections[0]!.fields[0]!.label.en).toBe('Rescue equipment')
        const [hazardSet] = await tx
          .select()
          .from(hazidHazardSets)
          .where(eq(hazidHazardSets.id, setId))
        expect(hazardSet!.hazardIds).toEqual([hazardId])
        await tx.insert(hazidAssessments).values({
          id: assessmentId,
          tenantId,
          reference: 'QA-SIGN',
          occurredAt: new Date(),
          reportedByTenantUserId: membership,
        })
        await tx
          .insert(hazidAssessmentQuestions)
          .values({ id: questionId, tenantId, assessmentId, question: 'Reviewed?', answer: 'yes' })
        await tx.insert(hazidSigningRounds).values({
          tenantId,
          assessmentId,
          revision: 1,
          snapshot: { values: { reference: 'QA-SIGN', tasks: [] }, apps: [] },
        })
        await tx
          .update(hazidAssessments)
          .set({ signingFrozenAt: new Date() })
          .where(eq(hazidAssessments.id, assessmentId))
        await tx.insert(hazidAssessmentSignatures).values({
          id: signatureId,
          tenantId,
          assessmentId,
          personId,
          signatureType: 'internal',
          signerName: 'Signer QA',
          revision: 1,
          signatureAttachmentId: attachmentId,
          signedAt: new Date(),
          requestId: randomUUID(),
          requestedAt: new Date(),
          requestExpiresAt: new Date(Date.now() + 3600000),
        })
        currentCtx = {
          tenantId,
          userId,
          personId,
          membership: { id: membership, displayName: 'Signer QA' },
          isSuperAdmin: false,
          permissions: new Set(['hazid.read.own']),
          scopes: [{ type: 'self' }],
          timezone: 'America/Toronto',
          locale: 'en',
          defaultLocale: 'en',
          enabledLocales: ['en'],
          localeOverride: null,
          db: (run) => run(tx),
        }
        expect((await loadOwnSigningRequest(currentCtx, tx, signatureId)).kind).toBe('signed')
        await tx
          .update(hazidAssessmentQuestions)
          .set({ entityOrder: 2 })
          .where(eq(hazidAssessmentQuestions.id, questionId))
        let [parent] = await tx
          .select()
          .from(hazidAssessments)
          .where(eq(hazidAssessments.id, assessmentId))
        expect(parent!.signingRevision).toBe(1)
        await tx
          .update(hazidAssessmentQuestions)
          .set({ answer: 'no' })
          .where(eq(hazidAssessmentQuestions.id, questionId))
        ;[parent] = await tx
          .select()
          .from(hazidAssessments)
          .where(eq(hazidAssessments.id, assessmentId))
        expect(parent!.signingRevision).toBe(2)
        expect((await loadOwnSigningRequest(currentCtx, tx, signatureId)).kind).toBe('changed')
        expect(
          (await loadOwnSigningRequest({ ...currentCtx, userId: randomUUID() }, tx, signatureId))
            .kind,
        ).toBe('unavailable')
        expect(
          (await loadOwnSigningRequest({ ...currentCtx, tenantId: foreign }, tx, signatureId)).kind,
        ).toBe('unavailable')
        const history = await loadSigningHistory(currentCtx, assessmentId, {
          signHistoryQ: 'Signer',
        })
        expect(history?.rows[0]?.signatureAttachmentId).toBe(attachmentId)
        expect((await loadSignedVersion(currentCtx, assessmentId, 1))?.round.revision).toBe(1)
        expect(
          await loadSignedVersion(
            { ...currentCtx, userId: randomUUID(), membership: null },
            assessmentId,
            1,
          ),
        ).toBeNull()
        const opened = await openCurrentSigningRequest(signatureId)
        expect(opened.ok).toBe(true)
        if (!opened.ok) throw Error('Expected successful recovery')
        const ready = await requireOwnHazidSignature(currentCtx, tx, opened.data.signatureId)
        expect(ready.signature.revision).toBe(2)
        const [originalRequest] = await tx
          .select()
          .from(hazidAssessmentSignatures)
          .where(eq(hazidAssessmentSignatures.id, signatureId))
        expect(ready.signature.requestExpiresAt).toEqual(originalRequest!.requestExpiresAt)
        const audit = await tx.select().from(auditLog).where(eq(auditLog.entityId, assessmentId))
        expect(
          audit.some(
            (row) => row.summary === 'Opened current signing version from an earlier request',
          ),
        ).toBe(true)
        expect(ready.signature.signatureAttachmentId).toBeNull()
        const [old] = await tx
          .select()
          .from(hazidAssessmentSignatures)
          .where(eq(hazidAssessmentSignatures.id, signatureId))
        expect(old!.signatureAttachmentId).toBe(attachmentId)
        await tx
          .update(hazidAssessmentSignatures)
          .set({ requestExpiresAt: new Date(0) })
          .where(eq(hazidAssessmentSignatures.id, signatureId))
        expect((await loadOwnSigningRequest(currentCtx, tx, signatureId)).kind).toBe('expired')
        await tx
          .update(hazidAssessmentSignatures)
          .set({ requestExpiresAt: new Date(Date.now() + 60_000) })
          .where(eq(hazidAssessmentSignatures.id, signatureId))
        await tx
          .delete(hazidAssessmentSignatures)
          .where(eq(hazidAssessmentSignatures.id, opened.data.signatureId))
        expect((await loadOwnSigningRequest(currentCtx, tx, signatureId)).kind).toBe('removed')
        await tx
          .update(hazidAssessments)
          .set({ deletedAt: new Date() })
          .where(eq(hazidAssessments.id, assessmentId))
        expect((await loadOwnSigningRequest(currentCtx, tx, signatureId)).kind).toBe('unavailable')
        const unsnapshottedId = randomUUID(),
          unsnapshottedQuestion = randomUUID(),
          unsnapshottedSignature = randomUUID()
        await tx.insert(hazidAssessments).values({
          id: unsnapshottedId,
          tenantId,
          reference: 'QA-UNSNAPSHOTTED',
          occurredAt: new Date(),
          reportedByTenantUserId: membership,
        })
        await tx.insert(hazidAssessmentQuestions).values({
          id: unsnapshottedQuestion,
          tenantId,
          assessmentId: unsnapshottedId,
          question: 'Old job?',
          answer: 'yes',
        })
        await tx.insert(hazidAssessmentSignatures).values({
          id: unsnapshottedSignature,
          tenantId,
          assessmentId: unsnapshottedId,
          revision: 1,
          personId,
          signatureType: 'internal',
          signatureAttachmentId: attachmentId,
          signedAt: new Date(),
          signerName: 'Signer QA',
        })
        await tx
          .update(hazidAssessmentQuestions)
          .set({ answer: 'no' })
          .where(eq(hazidAssessmentQuestions.id, unsnapshottedQuestion))
        const oldEvidence = await loadSigningHistory(currentCtx, unsnapshottedId, {})
        expect(oldEvidence?.revision).toBe(2)
        expect(oldEvidence?.rows[0]?.signatureAttachmentId).toBe(attachmentId)
        expect(oldEvidence?.rows[0]?.snapshotAvailable).toBe(false)
        throw rollback
      }),
    ).rejects.toSatisfy((error) => {
      if (error !== rollback) console.error(error)
      return error === rollback
    })
  } finally {
    await c.sql.end()
  }
})
