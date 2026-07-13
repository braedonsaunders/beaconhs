import 'server-only'

import { headers } from 'next/headers'
import { getAuth } from '@beaconhs/auth'
import { createInviteGrant, inviteCallbackPath } from '@beaconhs/auth/invites'

type MembershipInviteEmail = {
  membershipId: string
  tenantId: string
  tenantName: string
  userId: string
  email: string
  invitedAt: Date
  name?: string | null
}

/**
 * Issue the one-time Better Auth link whose callback is bound to exactly one
 * pending tenant membership. Callers own membership creation/auditing; this
 * helper owns only link construction and delivery.
 */
export async function sendMembershipInviteEmail(invite: MembershipInviteEmail): Promise<void> {
  const grant = createInviteGrant({
    membershipId: invite.membershipId,
    tenantId: invite.tenantId,
    userId: invite.userId,
    invitedAt: invite.invitedAt,
  })
  const callbackURL = inviteCallbackPath(grant)
  await getAuth().api.signInMagicLink({
    body: {
      email: invite.email,
      name: invite.name?.trim() || undefined,
      callbackURL,
      errorCallbackURL: callbackURL,
      metadata: { flow: 'invite', tenantName: invite.tenantName },
    },
    headers: (await headers()) as unknown as Headers,
  })
}
