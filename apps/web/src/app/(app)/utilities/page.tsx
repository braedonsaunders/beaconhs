import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, Download, LockKeyhole } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Utilities' }

// Utility actions landing - bulk admin tasks that work across modules. Each
// utility should record an audit entry when it runs.

const UTILITIES = [
  {
    href: '/utilities/export',
    icon: Download,
    permission: 'utilities.export',
    title: 'Data export',
    description: 'Bulk export tenant records through the canonical module CSV endpoints.',
  },
] as const

export default async function UtilitiesLandingPage() {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'utilities.view')) notFound()
  const utilities = UTILITIES.filter((u) => can(ctx, u.permission))

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Utilities"
          description="Tenant-wide administrative actions for sensitive cross-module work."
        />
        {utilities.length === 0 ? (
          <EmptyState
            icon={<LockKeyhole size={32} />}
            title="No utilities available"
            description="Your role can open Utilities, but it has not been granted access to any tenant-wide utility actions."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {utilities.map((u) => {
              const Icon = u.icon
              return (
                <Link key={u.href} href={u.href as any} className="group block focus:outline-none">
                  <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-teal-600">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                            <Icon size={20} />
                          </span>
                          <CardTitle>{u.title}</CardTitle>
                        </div>
                        <ChevronRight
                          size={18}
                          className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700 dark:group-hover:text-teal-300"
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{u.description}</CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
