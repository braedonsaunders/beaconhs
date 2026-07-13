import { can, type RequestContext } from '@beaconhs/tenant'

/** One capability gates the native Safe Distance tool end to end. */
export const SAFE_DISTANCE_PERMISSION = 'tools.safe-distance.use' as const

export function canUseSafeDistance(ctx: RequestContext): boolean {
  return can(ctx, SAFE_DISTANCE_PERMISSION)
}
