import { can, type RequestContext } from '@beaconhs/tenant'

export const TRAINING_CREDENTIAL_DESIGN_PERMISSION = 'training.course.manage'

export function canDesignTrainingCredentials(ctx: RequestContext): boolean {
  return (
    ctx.isSuperAdmin ||
    can(ctx, TRAINING_CREDENTIAL_DESIGN_PERMISSION) ||
    can(ctx, 'admin.settings.manage')
  )
}
