import Link from 'next/link'
import { ChevronRight, QrCode, Ruler } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Tools' }

// Tools landing — small catalogue of standalone calculators / utilities that
// don't belong inside a domain module. New tools added here should also be
// listed in the README's tooling section so they're discoverable.

const TOOLS = [
  {
    href: '/tools/safe-distance',
    icon: Ruler,
    title: 'Safe Distance',
    description:
      'Compute required minimum distance for electrical proximity, drone clearances, overhead-crane swing, and vehicle stand-off. Records each assessment for sign-off and PDF export.',
  },
  {
    href: '/equipment/bulk-qr',
    icon: QrCode,
    title: 'Bulk QR Generator',
    description:
      'Generate a printable sheet of QR codes for a selected set of equipment items — perfect for tagging a yard before audit season.',
  },
] as const

export default function ToolsLandingPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Tools"
          description="Standalone calculators and utilities that span the whole tenant."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.href}
                href={t.href as any}
                className="group block focus:outline-none"
              >
                <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-teal-600">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                          <Icon size={20} />
                        </span>
                        <CardTitle>{t.title}</CardTitle>
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
