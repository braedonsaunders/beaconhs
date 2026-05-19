import Link from 'next/link'
import {
  Activity,
  BarChart3,
  CalendarCheck,
  Coins,
  Droplet,
  FileBarChart,
  Receipt,
  Truck,
} from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment reports' }

const REPORTS: {
  href: string
  title: string
  description: string
  icon: React.ReactNode
  badge?: string
}[] = [
  {
    href: '/equipment/reports/fleet',
    title: 'Fleet report',
    description:
      'One row per asset with type, status, current site/holder, hours, km, expenses YTD, last & next inspection.',
    icon: <Truck size={20} className="text-slate-600" />,
  },
  {
    href: '/equipment/reports/roi',
    title: 'Return on investment',
    description:
      'Revenue (rate × hours) minus expenses minus purchase price per asset. Sorted by net profit.',
    icon: <BarChart3 size={20} className="text-slate-600" />,
    badge: 'Per type',
  },
  {
    href: '/equipment/reports/upcoming-inspections',
    title: 'Upcoming inspections',
    description:
      'Pre-use / monthly / annual inspections due in the next 30 days, plus everything currently overdue.',
    icon: <CalendarCheck size={20} className="text-slate-600" />,
  },
  {
    href: '/equipment/reports/upcoming-oil-change',
    title: 'Upcoming oil changes',
    description: 'Equipment with oil changes due in the next 30 days.',
    icon: <Droplet size={20} className="text-slate-600" />,
  },
  {
    href: '/equipment/reports/charges',
    title: 'Monthly charges',
    description:
      'Per-project / per-customer rollup of expenses + rate × usage hours across the fleet.',
    icon: <Receipt size={20} className="text-slate-600" />,
    badge: 'Monthly',
  },
]

export default function EquipmentReportsHub() {
  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Equipment reports"
            description="Fleet status, ROI, upcoming inspections / oil changes, and monthly charges — each report exports to CSV and PDF."
          />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href as any} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    {r.icon}
                    {r.title}
                  </span>
                  {r.badge ? <Badge variant="secondary">{r.badge}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">{r.description}</p>
                <div className="mt-3 text-xs font-medium text-teal-700 group-hover:underline">
                  Open report →
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </ListPageLayout>
  )
}
