import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'
import {
  acceptInviteAfterMagicLink,
  inviteGrantFromCallbackURL,
  INVITE_LINK_TTL_SECONDS,
} from './invites'

function createAuth() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('[auth] DATABASE_URL is required.')
  }

  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

  // BETTER_AUTH_SECRET signs sessions AND seals stored provider API keys.
  // Runtime initialization fails closed in production; a Next build merely
  // imports this module and therefore never needs access to runtime secrets.
  const envSecret = process.env.BETTER_AUTH_SECRET
  if (!envSecret && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[auth] BETTER_AUTH_SECRET must be set in production — refusing to start with the dev fallback secret',
    )
  }
  if (envSecret && process.env.NODE_ENV === 'production' && envSecret.length < 32) {
    throw new Error('[auth] BETTER_AUTH_SECRET must contain at least 32 characters in production.')
  }
  const secret = envSecret ?? 'dev-only-secret-rotate-me'

  return betterAuth({
    database: new Pool({ connectionString: databaseUrl }),
    baseURL,
    secret,
    emailAndPassword: {
      enabled: true,
      // BeaconHS is invite-only. Accounts are created by tenant/platform admins;
      // password sign-in and self-service resets remain available afterward.
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      autoSignIn: true,
      // Self-service password reset. `url` already points at the API callback
      // (`/api/auth/reset-password/<token>?callbackURL=/reset-password`), which
      // validates the token and forwards the user to our /reset-password page.
      sendResetPassword: async ({ user, url }) => {
        const subject = 'Reset your BeaconHS password'
        const text = `A password reset was requested for your BeaconHS account.\n\nSet a new password:\n\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email — your password won't change.`
        const html = `<p>A password reset was requested for your BeaconHS account.</p><p><a href="${url}">Set a new password</a></p><p>This link expires in 1 hour. If you didn't request it, ignore this email — your password won't change.</p>`
        await sendAuthEmail({ to: user.email, subject, html, text, label: 'password-reset' })
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: INVITE_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url, metadata }) => {
          const invite = metadata?.flow === 'invite'
          const tenantName =
            typeof metadata?.tenantName === 'string' && metadata.tenantName.trim()
              ? metadata.tenantName.trim()
              : 'your organization'
          const subject = invite
            ? `You're invited to ${tenantName} in BeaconHS`
            : 'Sign in to BeaconHS'
          const text = invite
            ? `You've been invited to join ${tenantName} in BeaconHS.\n\nAccept the invitation and sign in:\n\n${url}\n\nThis one-time link expires in 15 minutes. If you weren't expecting this invitation, ignore this email.`
            : `Click this link to sign in to BeaconHS:\n\n${url}\n\nThis one-time link expires in 15 minutes. If you didn't request it, ignore this email.`
          const html = invite
            ? `<p>You've been invited to join <strong>${escapeHtml(tenantName)}</strong> in BeaconHS.</p><p><a href="${url}">Accept the invitation and sign in</a></p><p>This one-time link expires in 15 minutes.</p>`
            : `<p>Click <a href="${url}">here</a> to sign in to BeaconHS.</p><p>This one-time link expires in 15 minutes.</p>`
          await sendAuthEmail({
            to: email,
            subject,
            html,
            text,
            label: invite ? 'invite' : 'magic-link',
          })
        },
      }),
      nextCookies(),
    ],
    hooks: {
      after: async (rawCtx) => {
        const ctx = rawCtx as unknown as {
          path?: string
          query?: { callbackURL?: unknown }
          context: { newSession?: { user: { id: string } } | null }
        }
        // Invitation activation is deliberately coupled to successful one-time
        // magic-link verification. A password session, a generic sign-in link,
        // or a direct visit to /invite/accept can never perform this transition.
        if (ctx.path !== '/magic-link/verify') return {}
        const sessionUserId = ctx.context.newSession?.user.id
        if (!sessionUserId) return {}
        const callbackURL = ctx.query?.callbackURL
        const grant = inviteGrantFromCallbackURL(callbackURL, baseURL)
        if (!grant) return {}
        try {
          const state = await acceptInviteAfterMagicLink(grant, sessionUserId)
          if (state !== 'active') {
            console.warn(`[auth] invite acceptance was not completed (${state})`)
          }
        } catch (error) {
          // The auth token is already consumed at this point. Preserve the valid
          // session/callback so the user sees a truthful recovery screen instead
          // of a 500 with a spent link; no membership is activated on failure.
          console.error('[auth] invite acceptance failed', error)
        }
        // Better Auth's global after hook contract requires a result object.
        // Returning undefined makes its dispatcher dereference result.headers
        // after every session lookup, breaking authenticated route prefetches.
        return {}
      },
    },
    trustedOrigins: [baseURL],
  })
}

export type AuthInstance = ReturnType<typeof createAuth>

let auth: AuthInstance | undefined

/** Materialize the process-wide Better Auth singleton on first runtime use. */
export function getAuth(): AuthInstance {
  auth ??= createAuth()
  return auth
}

export type Session = Awaited<ReturnType<AuthInstance['api']['getSession']>>

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Shared sender for transactional auth emails (magic link, password reset).
// In production the email is durably enqueued on the shared job queue. The
// worker resolves the effective transport per send from the platform/tenant
// email config (Resend, SendGrid, Mailgun, Postmark, or SMTP), so no specific
// provider env var is required here. The direct-SMTP path below is strictly the
// local-dev path that delivers to Mailpit. Queue failures and local SMTP
// failures propagate; production provider acceptance happens later in the
// worker. Secret-bearing auth URLs are never written to application logs.
async function sendAuthEmail(args: {
  to: string
  subject: string
  html: string
  text: string
  label: string
}) {
  const { to, subject, html, text, label } = args
  if (process.env.NODE_ENV === 'production') {
    const { enqueueEmail } = await import('@beaconhs/jobs')
    await enqueueEmail({ to, subject, html, text, meta: { category: 'auth' } })
    return
  }
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('[auth] Direct SMTP delivery is available only in local development.')
  }
  await sendViaSmtp({ to, subject, html, text })
  console.log(`[auth] ${label} accepted by the local SMTP server for ${to}`)
}

// Local Mailpit uses the same tested SMTP transport as production providers so
// multiline replies, fragmented packets, timeouts, MIME encoding and dot
// stuffing are handled by Nodemailer rather than a bespoke protocol client.
async function sendViaSmtp(args: {
  to: string | string[]
  subject: string
  html: string
  text: string
}) {
  const { sendVia } = await import('@beaconhs/emails')
  const host = process.env.SMTP_HOST ?? 'localhost'
  const port = Number(process.env.SMTP_PORT ?? 1025)
  const from = process.env.SMTP_FROM ?? 'BeaconHS <noreply@beaconhs.local>'
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('[auth] SMTP_PORT must be a whole number from 1 to 65535.')
  }
  await sendVia(
    { provider: 'smtp', mode: 'local-dev', host, port, secure: false, from },
    { to: args.to, subject: args.subject, html: args.html, text: args.text },
  )
}
