'use server'

import { eq } from 'drizzle-orm'
import { tenants, trainingCourses } from '@beaconhs/db/schema'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  courseCredentialOutputIds,
  type CredentialOutput,
} from '@/lib/credential-designs'
import {
  CredentialDesignValidationError,
  parseCredentialOutputsForSave,
} from '@/lib/credential-design-write'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { recordAuditInTransaction } from '@/lib/audit'
import { setTenantSettingInTransaction } from '@/lib/tenant-settings'

export type SaveCredentialOutputsResult =
  { ok: true; outputs: CredentialOutput[] } | { ok: false; error: string }

export async function saveCredentialOutputs(input: unknown): Promise<SaveCredentialOutputsResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  if (!canDesignTrainingCredentials(ctx)) {
    throw new Error('Forbidden: training credential design permission required')
  }

  let outputs: CredentialOutput[]
  try {
    outputs = parseCredentialOutputsForSave(input)
  } catch (error) {
    if (error instanceof CredentialDesignValidationError) {
      return { ok: false, error: error.message }
    }
    console.error('[credential-designs] validation failed unexpectedly', error)
    return { ok: false, error: 'Credential designs could not be validated. Please try again.' }
  }

  try {
    await ctx.db(async (tx) => {
      const [tenant] = await tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      const previous = tenant?.settings
      const previousIds = Array.isArray(
        previous &&
          typeof previous === 'object' &&
          (previous as Record<string, unknown>)[CREDENTIAL_OUTPUTS_SETTINGS_KEY],
      )
        ? (
            (previous as Record<string, unknown>)[CREDENTIAL_OUTPUTS_SETTINGS_KEY] as unknown[]
          ).flatMap((entry) =>
            entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
              ? [(entry as { id: string }).id]
              : [],
          )
        : []
      const nextIds = new Set(outputs.map((output) => output.id))
      const removedIds = previousIds.filter((id) => !nextIds.has(id))

      await setTenantSettingInTransaction(
        tx,
        ctx.tenantId,
        CREDENTIAL_OUTPUTS_SETTINGS_KEY,
        outputs,
      )
      if (removedIds.length > 0) {
        const courses = await tx
          .select({ id: trainingCourses.id, metadata: trainingCourses.metadata })
          .from(trainingCourses)
        for (const course of courses) {
          const pinned = courseCredentialOutputIds(course.metadata)
          if (!pinned.some((id) => removedIds.includes(id))) continue
          const metadata =
            course.metadata &&
            typeof course.metadata === 'object' &&
            !Array.isArray(course.metadata)
              ? { ...(course.metadata as Record<string, unknown>) }
              : {}
          metadata.credentialOutputIds = pinned.filter((id) => !removedIds.includes(id))
          await tx
            .update(trainingCourses)
            .set({ metadata })
            .where(eq(trainingCourses.id, course.id))
        }
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_credential_design',
        action: 'update',
        summary: 'Saved training credential designs',
        metadata: {
          outputCount: outputs.length,
          removedIds,
          outputs: outputs.map((output) => ({
            id: output.id,
            format: output.format,
            templateId: output.templateId,
            enabled: output.enabled,
          })),
        },
      })
    })
  } catch (error) {
    console.error('[credential-designs] save failed', error)
    return { ok: false, error: 'Credential designs could not be saved. Please try again.' }
  }

  revalidatePath('/training/credential-designs')
  return { ok: true, outputs }
}
