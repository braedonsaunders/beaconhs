import { appVersion } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

/** No database work: an old tab can check its build before using an action ID. */
export function GET() {
  return Response.json({ version: appVersion() }, { headers: { 'Cache-Control': 'no-store' } })
}
