import { appBaseUrl } from '@/lib/app-base-url'
import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@beaconhs/auth'
import { inspectInviteForUser, type InviteAccessState } from '@beaconhs/auth/invites'
import { ACTIVE_ROLE_COOKIE, ACTIVE_TENANT_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function statusRedirect(state: InviteAccessState): NextResponse {
  const url = new URL('/invite/status', appBaseUrl())
  url.searchParams.set('state', state)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Better Auth adds `error=INVALID_TOKEN` here when its one-time token is
  // expired, invalid, or already consumed. Never inspect/activate in that case.
  if (req.nextUrl.searchParams.has('error')) return statusRedirect('expired')

  const grant = req.nextUrl.searchParams.get('grant') ?? ''
  if (!grant) return statusRedirect('invalid')

  const session = await getAuth()
    .api.getSession({ headers: req.headers })
    .catch(() => null)
  if (!session?.user?.id) return statusRedirect('invalid')

  const invite = await inspectInviteForUser(grant, session.user.id).catch(() => null)
  if (!invite) return statusRedirect('pending')
  if (invite.state !== 'active' || !invite.tenantId) {
    return statusRedirect(invite.state)
  }

  const response = NextResponse.redirect(new URL('/dashboard', appBaseUrl()))
  response.cookies.set(ACTIVE_TENANT_COOKIE, invite.tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  response.cookies.delete(ACTIVE_ROLE_COOKIE)
  return response
}
