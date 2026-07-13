import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { trainingCertificates, trainingSkillCertificates } from '@beaconhs/db/schema'

const MAX_TOKEN_ATTEMPTS = 5

type ConflictSafeIssuance<T> = {
  createVerifyToken: () => string
  insert: (verifyToken: string) => Promise<T | null>
  findExisting: () => Promise<T | null>
}

/**
 * Resolve concurrent lazy issuance without a read-then-insert race. The insert
 * uses ON CONFLICT DO NOTHING for both subject and token uniqueness. If the
 * conflict was for the same subject, return the winning row; if it was the
 * generated token, retry with fresh entropy.
 */
export async function issueCertificateConflictSafe<T>(
  issuance: ConflictSafeIssuance<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const created = await issuance.insert(issuance.createVerifyToken())
    if (created) return created

    const existing = await issuance.findExisting()
    if (existing) return existing
  }

  throw new Error('Failed to issue a certificate after repeated token conflicts')
}

function verifyToken(namespace: 'record' | 'skill'): string {
  return `${namespace}_${randomBytes(20).toString('hex')}`
}

export async function issueTrainingCertificate(
  tx: Database,
  input: { tenantId: string; recordId: string },
): Promise<typeof trainingCertificates.$inferSelect> {
  return issueCertificateConflictSafe({
    createVerifyToken: () => verifyToken('record'),
    insert: async (token) => {
      const [created] = await tx
        .insert(trainingCertificates)
        .values({
          tenantId: input.tenantId,
          recordId: input.recordId,
          verifyToken: token,
        })
        .onConflictDoNothing()
        .returning()
      return created ?? null
    },
    findExisting: async () => {
      const [existing] = await tx
        .select()
        .from(trainingCertificates)
        .where(eq(trainingCertificates.recordId, input.recordId))
        .limit(1)
      return existing ?? null
    },
  })
}

export async function issueTrainingSkillCertificate(
  tx: Database,
  input: { tenantId: string; skillAssignmentId: string },
): Promise<typeof trainingSkillCertificates.$inferSelect> {
  return issueCertificateConflictSafe({
    createVerifyToken: () => verifyToken('skill'),
    insert: async (token) => {
      const [created] = await tx
        .insert(trainingSkillCertificates)
        .values({
          tenantId: input.tenantId,
          skillAssignmentId: input.skillAssignmentId,
          verifyToken: token,
        })
        .onConflictDoNothing()
        .returning()
      return created ?? null
    },
    findExisting: async () => {
      const [existing] = await tx
        .select()
        .from(trainingSkillCertificates)
        .where(eq(trainingSkillCertificates.skillAssignmentId, input.skillAssignmentId))
        .limit(1)
      return existing ?? null
    },
  })
}
