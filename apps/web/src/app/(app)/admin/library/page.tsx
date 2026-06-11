import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import { count } from 'drizzle-orm'
import {
  atmosphericSensors,
  inspectionBanks,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Library & catalogues' }

export const dynamic = 'force-dynamic'

export default async function LibraryHubPage() {
  const ctx = await requireRequestContext()
  const counts = await ctx.db(async (tx) => {
    const [banks] = await tx.select({ c: count() }).from(inspectionBanks)
    const [auths] = await tx.select({ c: count() }).from(trainingSkillAuthorities)
    const [skills] = await tx.select({ c: count() }).from(trainingSkillTypes)
    const [sensors] = await tx.select({ c: count() }).from(atmosphericSensors)
    return {
      banks: Number(banks?.c ?? 0),
      auths: Number(auths?.c ?? 0),
      skills: Number(skills?.c ?? 0),
      sensors: Number(sensors?.c ?? 0),
    }
  })

  const sections = [
    {
      href: '/inspections/banks',
      title: 'Inspection banks',
      desc: 'Reusable inspection-criteria templates used by inspections + audits.',
      count: counts.banks,
    },
    {
      href: '/training/authorities',
      title: 'Skill authorities',
      desc: 'Issuing bodies for certifications (e.g. WSIB, IHSA, in-house).',
      count: counts.auths,
    },
    {
      href: '/training/skills/types',
      title: 'Skill types',
      desc: 'Catalogue of recognized skills and competencies workers can hold.',
      count: counts.skills,
    },
    {
      href: '/confined-space/sensors',
      title: 'Atmospheric sensors',
      desc: 'Calibration register for 4-gas monitors used on confined-space entries.',
      count: counts.sensors,
    },
  ] as const

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <Link href="/admin" className="text-xs text-slate-500 hover:text-teal-700">
            ← Back to admin
          </Link>
          <PageHeader
            title="Library & catalogues"
            description="Long-lived reference data shared across modules. Most users won't touch these often — they're maintained by admins."
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {sections.map((s) => (
            <Link key={s.href} href={s.href as any} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{s.title}</CardTitle>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {s.count}
                    </span>
                  </div>
                  <CardDescription>{s.desc}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
