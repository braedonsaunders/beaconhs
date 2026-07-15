import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { ChevronRight, Gauge, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { and, asc, eq } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { formTemplates } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { canUseSafeDistance, SAFE_DISTANCE_PERMISSION } from '@/lib/safe-distance-access'
import { PageContainer } from '@/components/page-layout'
import { templateAccessWhere } from '../apps/_lib/access'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0026cfb826b558') }
}
export const dynamic = 'force-dynamic'

// Tools landing — a registry-driven catalogue. NATIVE tools are coded modules
// (calculators / utilities that don't belong inside a domain module). USER
// tools are published Builder apps a tenant flagged "Show in the Tools
// catalogue" (form_templates.surface_as_tool) — they deep-link to the filler.
// New native tools added here should also be listed in the README tooling
// section so they stay discoverable.

type ToolCard = {
  href: string
  icon: LucideIcon
  title: string
  description: string
  custom?: boolean
  requiredPermission?: string
}

const NATIVE_TOOLS: ToolCard[] = [
  {
    href: '/tools/safe-distance',
    icon: Gauge,
    title: 'Safe Distance',
    requiredPermission: SAFE_DISTANCE_PERMISSION,
    description:
      'Pneumatic pressure-test stand-off calculator — NASA-Glenn, ASME PCC-2, and Lloyd’s Register stored-energy distances for a piping system under test. Records each assessment for sign-off and PDF export.',
  },
]

export default async function ToolsLandingPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)

  // Published Builder apps the tenant chose to surface as tools.
  const customTools = can(ctx, 'forms.response.create')
    ? await ctx.db(async (tx) => {
        const rows = await tx
          .select({
            id: formTemplates.id,
            name: formTemplates.name,
            description: formTemplates.description,
          })
          .from(formTemplates)
          .where(
            and(
              eq(formTemplates.surfaceAsTool, true),
              templateAccessWhere(ctx, effectiveRoleKeys, 'operate'),
            ),
          )
          .orderBy(asc(formTemplates.name))
        return rows
      })
    : []

  const tools: ToolCard[] = [
    ...NATIVE_TOOLS.filter((tool) => !tool.requiredPermission || canUseSafeDistance(ctx)),
    ...customTools.map((t) => ({
      href: `/apps/templates/${t.id}/fill`,
      icon: Wrench,
      title: t.name,
      description: t.description ?? 'Tenant-built tool.',
      custom: true,
    })),
  ]

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title={tGenerated('m_0026cfb826b558')}
          description={tGenerated('m_00c2b5f0b831ae')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <GeneratedValue
            value={tools.map((t) => {
              const Icon = t.icon
              return (
                <Link key={t.href} href={t.href as any} className="group block focus:outline-none">
                  <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-teal-600">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                            <Icon size={20} />
                          </span>
                          <CardTitle>
                            <GeneratedValue value={t.title} />
                          </CardTitle>
                          <GeneratedValue
                            value={
                              t.custom ? (
                                <Badge variant="secondary" className="ml-1">
                                  <GeneratedText id="m_1721ac81d2a5c0" />
                                </Badge>
                              ) : null
                            }
                          />
                        </div>
                        <ChevronRight
                          size={18}
                          className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>
                        <GeneratedValue value={t.description} />
                      </CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          />
        </div>
      </div>
    </PageContainer>
  )
}
