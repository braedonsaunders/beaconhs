import { can, type RequestContext } from '@beaconhs/tenant'

export type JournalMutation = 'edit' | 'submit'
type JournalMutationScope = 'read_scope' | 'self' | 'none'

/**
 * A read tier never widens a write tier. Only journals.assign authorizes
 * writes to another person's visible entry; update.own and submit stay
 * self-scoped even when a custom role also has read.site/read.all.
 */
export function journalMutationScope(
  ctx: RequestContext,
  mutation: JournalMutation,
): JournalMutationScope {
  if (ctx.isSuperAdmin || can(ctx, 'journals.assign')) return 'read_scope'
  if (mutation === 'edit' && can(ctx, 'journals.update.own')) return 'self'
  if (mutation === 'submit' && can(ctx, 'journals.submit')) return 'self'
  return 'none'
}

export function canCreateJournal(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'journals.create')
}

export function canEmailJournal(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'journals.submit') || can(ctx, 'journals.assign')
}
