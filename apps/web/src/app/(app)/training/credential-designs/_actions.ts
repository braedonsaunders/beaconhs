'use server'

import { requireRequestContext } from '@/lib/auth'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  normalizeCredentialOutputs,
  type CredentialOutput,
} from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { recordAudit } from '@/lib/audit'
import { setTenantSetting } from '@/lib/tenant-settings'

export async function saveCredentialOutputs(input: CredentialOutput[]) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  if (!canDesignTrainingCredentials(ctx)) {
    throw new Error('Forbidden: training credential design permission required')
  }

  const outputs = normalizeCredentialOutputs({ [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: input })
  await setTenantSetting(ctx, CREDENTIAL_OUTPUTS_SETTINGS_KEY, outputs)

  await recordAudit(ctx, {
    entityType: 'training_credential_design',
    action: 'update',
    summary: 'Saved training credential designs',
    metadata: {
      outputs: outputs.map((output) => ({
        id: output.id,
        format: output.format,
        templateId: output.templateId,
        enabled: output.enabled,
      })),
    },
  })

  return outputs
}
