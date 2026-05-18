import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { db } from '@beaconhs/db'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
const secret = process.env.BETTER_AUTH_SECRET

if (!secret) {
  console.warn(
    '[auth] BETTER_AUTH_SECRET is not set. Sessions will not survive process restarts in dev.',
  )
}

export const auth = betterAuth({
  database: {
    // Better-Auth supports many adapters; we run against the same Postgres
    // via a Drizzle adapter so our `users` and `sessions` tables stay canonical.
    provider: 'pg',
    db: db as unknown as never, // adapter integration TODO once chosen finally
  } as never,
  baseURL,
  secret: secret ?? 'dev-only-secret-rotate-me',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [
    magicLink({
      // Send the link via the email queue (consumed by apps/worker)
      sendMagicLink: async ({ email, token, url }) => {
        // Lazy import to avoid pulling email deps into web bundle if unused
        const { enqueueEmail } = await import('@beaconhs/jobs/email').catch(() => ({
          enqueueEmail: async () => {
            console.log(`[auth/magic-link] (no email queue) ${email}: ${url}`)
          },
        })) as { enqueueEmail?: (args: { to: string; subject: string; html: string; text: string }) => Promise<void> }

        const subject = 'Sign in to BeaconHS'
        const text = `Click the link to sign in: ${url}\n\nThis link expires in 15 minutes.`
        const html = `<p>Click <a href="${url}">here</a> to sign in to BeaconHS.</p><p>This link expires in 15 minutes.</p><hr/><p style="color:#666;font-size:12px">Token: ${token.slice(0, 8)}…</p>`
        if (enqueueEmail) {
          await enqueueEmail({ to: email, subject, html, text })
        } else {
          console.log(`[auth] magic-link for ${email}: ${url}`)
        }
      },
    }),
  ],
  trustedOrigins: [baseURL],
})

export type AuthInstance = typeof auth
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>
