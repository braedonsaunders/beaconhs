import { NextResponse } from 'next/server'

/**
 * Next.js `<Link>` prefetch (viewport and hover) issues a real GET to the
 * href. File-download route handlers must no-op those requests — they run
 * queries and write audit rows, and a filter change can fire three of them
 * at once.
 */
export function isRouterPrefetch(request: Request): boolean {
  return (
    request.headers.has('next-router-prefetch') ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose') === 'prefetch'
  )
}

export function rejectRouterPrefetch(request: Request): NextResponse | null {
  if (!isRouterPrefetch(request)) return null
  return new NextResponse(null, { status: 204 })
}
