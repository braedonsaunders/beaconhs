// SMS delivery. The provider abstraction (Twilio, Vonage, MessageBird, Plivo,
// Telnyx) lives in ./providers + ./transport. This file keeps `sendSms` as the
// ENVIRONMENT fallback — used when no tenant/platform provider is configured —
// reading the legacy TWILIO_* env vars so deployments that set up SMS before the
// provider settings UI keep working unchanged.

import { buildSmsTransport, sendSmsVia, type SendSmsInput } from './transport'

export * from './providers'
export * from './transport'

// The worker resolves a tenant/platform transport first (see
// @beaconhs/worker resolve-sms-transport) and only falls back to this when
// none is configured: a Twilio account in the environment, or a dev stdout log.
export async function sendSms(input: SendSmsInput): Promise<{ id: string }> {
  const transport = buildSmsTransport({
    provider: 'twilio',
    fromNumber: input.from ?? process.env.TWILIO_FROM,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    secret: process.env.TWILIO_AUTH_TOKEN,
  })
  if (!transport) {
    // Dev fallback: log to stdout so engineers can see what would have been sent.
    console.log('[sms] (no provider configured) →', input.to, input.body.slice(0, 80))
    return { id: 'dev-skipped' }
  }
  return sendSmsVia(transport, input)
}
