import { can, type RequestContext } from '@beaconhs/tenant'

export function canFacilitateDocumentSignoff(ctx: RequestContext): boolean {
  return (
    can(ctx, 'documents.manage') || (can(ctx, 'documents.read') && can(ctx, 'documents.signoff'))
  )
}
