import { redirect } from 'next/navigation'

// Lone-worker sessions are now monitored form responses. A session's live
// monitor lives on its response page (/forms/responses/[id]); the legacy
// /lone-worker/[id] route (old lw_session ids) redirects back to the dashboard.
export const dynamic = 'force-dynamic'

export default async function LegacyLoneWorkerSessionPage() {
  redirect('/lone-worker')
}
