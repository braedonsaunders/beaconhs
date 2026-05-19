import Link from 'next/link'
import { ChevronRight, Flame } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Training reports' }

const REPORTS = [
  {
    href: '/training/reports/cwb',
    title: 'CWB welder report',
    description:
      'Welder roster + Canadian Welding Bureau certifications + weld procedure qualifications. Required for CWB-registered shops.',
    icon: <Flame size={18} />,
  },
  {
    href: '/training/matrix',
    title: 'Training matrix',
    description:
      'Person × course coverage grid with valid / expiring / expired / never-taken cells. Useful as a department-level briefing.',
  },
  {
    href: '/training/transcripts',
    title: 'Per-person transcripts',
    description:
      'Pick a person to view their full training history, assessments, skills, and upcoming expirations. Printable.',
  },
] as const

export default function TrainingReportsIndex() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Training reports"
          description="Pre-built reports built from training records, assessments, and skills."
        />
        <TrainingSubNav active="reports" />

        <div className="grid gap-3">
          {REPORTS.map((r) => (
            <Link key={r.href} href={r.href as any} className="group">
              <Card className="transition group-hover:border-teal-500">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      {'icon' in r ? (
                        <span className="text-teal-700">{r.icon}</span>
                      ) : null}
                      {r.title}
                    </span>
                    <ChevronRight size={16} className="text-slate-400" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500">{r.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
