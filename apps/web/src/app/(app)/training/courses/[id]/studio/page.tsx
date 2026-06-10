import { redirect } from 'next/navigation'

// The studio was merged INTO the course page — /training/courses/[id] is the
// builder now (left rail + element palette, right build surface). This route
// stays so old links and ?lesson= deep-links keep working.
export default async function StudioRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const lesson = typeof sp.lesson === 'string' ? sp.lesson : undefined
  redirect(`/training/courses/${id}${lesson ? `?lesson=${lesson}` : ''}`)
}
