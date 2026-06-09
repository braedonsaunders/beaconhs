import Link from 'next/link'
import { ChevronRight, Download, ShieldAlert } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Utilities' }

// Utility actions landing — bulk admin tasks that work across modules. Each
// utility should record an audit entry when it runs (export logs go through
// recordAudit, analyze runs as a read-only).

const UTILITIES = [
  {
    href: '/utilities/export',
    icon: Download,
    title: 'Data export',
    description:
      'Bulk export of records (incidents, corrective actions, equipment, people, safe-distance, forms) to CSV or JSON. Every export writes an audit entry.',
  },
  {
    href: '/utilities/analyze',
    icon: ShieldAlert,
    title: 'Data quality analyzer',
    description:
      'Scan the tenant for missing-data problems: people without departments, equipment without types, corrective actions without sources, and incidents missing required fields.',
  },
] as const

export default function UtilitiesLandingPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Utilities"
          description="Tenant-wide admin actions that don't fit cleanly into a single module."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {UTILITIES.map((u) => {
            const Icon = u.icon
            return (
              <Link key={u.href} href={u.href as any} className="group block focus:outline-none">
                <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-teal-600">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                          <Icon size={20} />
                        </span>
                        <CardTitle>{u.title}</CardTitle>
                      </div>
                      <ChevronRight
                        size={18}
                        className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
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
      </div>
    </PageContainer>
  )
}
