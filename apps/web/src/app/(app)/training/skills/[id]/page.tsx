import { redirect } from 'next/navigation'

// The skill-type catalogue moved to /training/skills/types/* — /training/skills
// is now the operational Skills list (per-person assignments). Old deep links
// to a skill type land here; forward them.
export default async function SkillTypeRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/training/skills/types/${id}`)
}
