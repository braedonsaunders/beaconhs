import Link from 'next/link'
import { ChevronRight, Gauge, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { and, asc, eq, isNull } from 'drizzle-orm'
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
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Tools' }
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
}

const NATIVE_TOOLS: ToolCard[] = [
  {
    href: '/tools/safe-distance',
    icon: Gauge,
    title: 'Safe Distance',
    description:
      'Pneumatic pressure-test stand-off calculator — NASA-Glenn, ASME PCC-2, and Lloyd’s Register stored-energy distances for a piping system under test. Records each assessment for sign-off and PDF export.',
  },
]

export default async function ToolsLandingPage() {
  const ctx = await requireRequestContext()

  // Published Builder apps the tenant chose to surface as tools.
  const customTools = await ctx.db(async (tx) => {
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
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
        ),
      )
      .orderBy(asc(formTemplates.name))
    return rows
  })

  const tools: ToolCard[] = [
    ...NATIVE_TOOLS,
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
          title="Tools"
          description="Standalone calculators and utilities that span the whole tenant."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((t) => {
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
                        <CardTitle>{t.title}</CardTitle>
                        {t.custom ? (
                          <Badge variant="secondary" className="ml-1">
                            Custom
                          </Badge>
                        ) : null}
                      </div>
                      <ChevronRight
                        size={18}
                        className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{t.description}</CardDescription>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </PageContainer>
  )
}
