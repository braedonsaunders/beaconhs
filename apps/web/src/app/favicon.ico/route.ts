import { appBaseUrl } from '@/lib/app-base-url'

export const dynamic = 'force-dynamic'
export function GET(): Response {
  return Response.redirect(new URL('/icon0.svg', appBaseUrl()), 308)
}
