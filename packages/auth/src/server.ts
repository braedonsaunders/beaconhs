import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  // Don't throw at import time — the CLI/migrations need to load this file
  // before env is set in some flows. We just warn and let the runtime fail
  // when the auth client is actually used.
  console.warn('[auth] DATABASE_URL is not set at import time')
}

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

// BETTER_AUTH_SECRET signs sessions AND seals stored provider API keys. Running
// production on the publicly-known dev fallback would be a silent security
// hole, so refuse to boot rather than degrade.
const envSecret = process.env.BETTER_AUTH_SECRET
if (!envSecret && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[auth] BETTER_AUTH_SECRET must be set in production — refusing to start with the dev fallback secret',
  )
}
const secret = envSecret ?? 'dev-only-secret-rotate-me'

export const auth = betterAuth({
  database: new Pool({ connectionString: databaseUrl }),
  baseURL,
  secret,
  emailAndPassword: {
    enabled: true,
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
      await sendAuthEmail({ to: user.email, subject, html, text, label: 'password-reset', url })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const subject = 'Sign in to BeaconHS'
        const text = `Click this link to sign in to BeaconHS:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`
        const html = `<p>Click <a href="${url}">here</a> to sign in to BeaconHS.</p><p>This link expires in 15 minutes.</p>`
        await sendAuthEmail({ to: email, subject, html, text, label: 'magic-link', url })
      },
    }),
    nextCookies(),
  ],
  trustedOrigins: [baseURL],
})

export type AuthInstance = typeof auth
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>

// Shared sender for transactional auth emails (magic link, password reset).
// In production (or whenever a Resend env key hints at a real provider) the
// email is enqueued on the shared job queue: the worker resolves the effective
// transport per send from the platform/tenant email config (Resend, SendGrid,
// Mailgun, Postmark, SMTP — see apps/worker resolveEmailDelivery), so no
// specific provider env var is required here. The direct-SMTP path below is
// strictly the local-dev fallback that delivers to Mailpit; its failures are
// logged (with the actionable URL) instead of thrown so dev flows keep working.
async function sendAuthEmail(args: {
  to: string
  subject: string
  html: string
  text: string
  label: string
  /** The actionable link — logged to the console if delivery fails so dev still works. */
  url?: string
}) {
  const { to, subject, html, text, label, url } = args
  if (process.env.NODE_ENV === 'production' || process.env.RESEND_API_KEY) {
    const { enqueueEmail } = await import('@beaconhs/jobs')
    await enqueueEmail({ to, subject, html, text, meta: { category: 'auth' } })
    return
  }
  try {
    await sendViaSmtp({ to, subject, html, text })
    console.log(`[auth] ${label} sent to ${to} via Mailpit`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[auth] could not send ${label} to ${to} via Mailpit (${msg})${url ? `; URL: ${url}` : ''}`,
    )
  }
}

// Minimal SMTP client for Mailpit (no auth, plain text). Avoids pulling a
// full mail library when we just need dev delivery.
async function sendViaSmtp(args: {
  to: string | string[]
  subject: string
  html: string
  text: string
}) {
  const { createConnection } = await import('node:net')
  const host = process.env.SMTP_HOST ?? 'localhost'
  const port = Number(process.env.SMTP_PORT ?? 1025)
  const from = process.env.RESEND_FROM ?? 'BeaconHS <noreply@beaconhs.local>'
  const tos = Array.isArray(args.to) ? args.to : [args.to]
  const fromAddr = from.match(/<(.+)>/)?.[1] ?? from

  return new Promise<void>((resolve, reject) => {
    const sock = createConnection({ host, port })
    const lines: string[] = []
    let step = 0
    const send = (s: string) => sock.write(s + '\r\n')

    sock.on('data', (chunk) => {
      lines.push(chunk.toString())
      const data = chunk.toString()
      if (!data.startsWith('2') && !data.startsWith('3')) {
        sock.end()
        reject(new Error(`SMTP error: ${data.trim()}`))
        return
      }
      switch (step) {
        case 0:
          send(`EHLO beaconhs`)
          step++
          break
        case 1:
          send(`MAIL FROM:<${fromAddr}>`)
          step++
          break
        case 2:
          send(`RCPT TO:<${tos[0]}>`)
          step++
          break
        case 3:
          send(`DATA`)
          step++
          break
        case 4: {
          const boundary = '----=_BeaconHS' + Math.random().toString(36).slice(2)
          const body = [
            `From: ${from}`,
            `To: ${tos.join(', ')}`,
            `Subject: ${args.subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            ``,
            `--${boundary}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            args.text,
            ``,
            `--${boundary}`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            args.html,
            ``,
            `--${boundary}--`,
            `.`,
          ].join('\r\n')
          send(body)
          step++
          break
        }
        case 5:
          send(`QUIT`)
          step++
          break
        case 6:
          sock.end()
          resolve()
          break
      }
    })
    sock.on('error', reject)
  })
}
