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
const secret = process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-rotate-me'

export const auth = betterAuth({
  database: new Pool({ connectionString: databaseUrl }),
  baseURL,
  secret,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    autoSignIn: true,
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

        const apiKey = process.env.RESEND_API_KEY
        if (apiKey) {
          const { enqueueEmail } = await import('@beaconhs/jobs')
          await enqueueEmail({ to: email, subject, html, text })
          return
        }

        // Dev fallback: send via SMTP to Mailpit on localhost:1025.
        try {
          await sendViaSmtp({ to: email, subject, html, text })
          console.log(`[auth] magic-link sent to ${email} via Mailpit`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[auth] could not send magic-link via Mailpit (${msg}); URL:`, url)
        }
      },
    }),
    nextCookies(),
  ],
  trustedOrigins: [baseURL],
})

export type AuthInstance = typeof auth
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>

// Minimal SMTP client for Mailpit (no auth, plain text). Avoids pulling a
// full mail library when we just need dev delivery.
async function sendViaSmtp(args: { to: string | string[]; subject: string; html: string; text: string }) {
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
