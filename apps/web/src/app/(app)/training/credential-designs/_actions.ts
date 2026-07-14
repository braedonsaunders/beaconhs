'use server'

import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { CREDENTIAL_OUTPUTS_SETTINGS_KEY, type CredentialOutput } from '@/lib/credential-designs'
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
      await setTenantSettingInTransaction(
        tx,
        ctx.tenantId,
        CREDENTIAL_OUTPUTS_SETTINGS_KEY,
        outputs,
      )
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_credential_design',
        action: 'update',
        summary: 'Saved training credential designs',
        metadata: {
          outputCount: outputs.length,
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
