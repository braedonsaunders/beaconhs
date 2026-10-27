// Per-send email identity for MANUAL "send email" actions: the message
// shows "<acting user> via BeaconHS" (configured From address unchanged)
// and replies go to the acting user. System notices don't use this — they
// keep the plain configured sender.
import { eq } from 'drizzle-orm'
import { users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export async function actingUserEmailIdentity(
  ctx: RequestContext,
): Promise<{ senderName?: string; replyTo?: string }> {
  const [user] = await ctx.db((tx) =>
    tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1),
  )
  if (!user) return {}
  const senderName = user.name?.trim() || ctx.membership?.displayName?.trim() || undefined
  return {
    ...(senderName ? { senderName } : {}),
    ...(user.email ? { replyTo: user.email } : {}),
  }
}
