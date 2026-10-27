import { redirect } from 'next/navigation'

// The create form lives in a drawer on the list page now. This route stays
// as a redirect because saved dashboard layouts and bookmarks link here;
// every query param (source presets included) carries over.
export default async function NewCorrectiveActionRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'drawer') continue
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v)
    } else if (value !== undefined) {
      params.set(key, value)
    }
  }
  params.set('drawer', 'new')
  redirect(`/corrective-actions?${params.toString()}`)
}
