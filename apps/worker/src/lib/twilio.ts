// Twilio SMS sender. Lazily constructs the client so apps that don't set the
// env vars don't try to load the SDK at all — and we can fail soft in dev.
//
// Usage:
//   const result = await sendSms({ to: '+15551234567', body: 'msg' })
//   if (!result.sent) console.warn(result.reason)

import type { Twilio } from 'twilio'

type SendResult = { sent: true; sid: string } | { sent: false; reason: string }

let client: Twilio | null = null
let initFailed = false

function getClient(): Twilio | null {
  if (initFailed) return null
  if (client) return client
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  try {
    // Dynamic import (CJS interop). The package exports a default factory.
    // We cast through unknown because the optional dep may not be installed
    // in environments that don't ship SMS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio') as (sid: string, token: string) => Twilio
    client = twilio(sid, token)
    return client
  } catch (err) {
    initFailed = true
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[sms] twilio sdk unavailable: ${msg}`)
    return null
  }
}

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM,
  )
}

export async function sendSms(args: { to: string; body: string }): Promise<SendResult> {
  if (!smsConfigured()) {
    return { sent: false, reason: 'TWILIO_* not configured' }
  }
  const c = getClient()
  if (!c) {
    return { sent: false, reason: 'twilio client unavailable' }
  }
  try {
    const msg = await c.messages.create({
      to: args.to,
      from: process.env.TWILIO_FROM!,
      body: args.body,
    })
    return { sent: true, sid: msg.sid }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { sent: false, reason }
  }
}
