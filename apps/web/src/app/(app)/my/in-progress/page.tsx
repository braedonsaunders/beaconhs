import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// "In progress" — a card per unfinished entry the current user authored across
// modules (journals, hazard assessments, incidents, inspections). Each card
// links into the entry to resume it. Same data as the dashboard "In progress"
// widget and the Workspace tile (see loadInProgressEntries).

import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  NotebookPen,
  PencilLine,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'
import { Button, cn, EmptyState, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { relativeTime } from '../../journals/_format'
import { loadInProgressEntries, type InProgressEntry } from '../../dashboard/_metrics'
import { WorkspaceNoIdentity } from '../_no-identity'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a03b06872ffd9') }
}
export const dynamic = 'force-dynamic'

const KIND_META: Record<
  InProgressEntry['kind'],
  { label: string; icon: LucideIcon; chip: string; ghost: string }
> = {
  journal: {
    label: 'Journal',
    icon: NotebookPen,
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
    ghost: 'text-teal-500/10 dark:text-teal-400/15',
  },
  hazard_assessment: {
    label: 'Hazard assessment',
    icon: ShieldAlert,
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    ghost: 'text-amber-500/10 dark:text-amber-400/15',
  },
  incident: {
    label: 'Incident',
    icon: AlertTriangle,
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    ghost: 'text-rose-500/10 dark:text-rose-400/15',
  },
  inspection: {
    label: 'Inspection',
    icon: ClipboardCheck,
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    ghost: 'text-sky-500/10 dark:text-sky-400/15',
  },
}

export default async function MyInProgressPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  const header = (
    <PageHeader
      back={{ href: '/my', label: 'Workspace' }}
      title={tGenerated('m_1a03b06872ffd9')}
      description={tGenerated('m_1844c2816e2bdc')}
    />
  )

  // Without a membership (super-admin viewing-as) there's nothing to scope to.
  if (!membershipId) {
    return (
      <PageContainer>
        <div className="space-y-5">
          <GeneratedValue value={header} />
          <WorkspaceNoIdentity reason="no-membership" noun="unfinished entries" />
        </div>
      </PageContainer>
    )
  }

  const entries = await ctx.db((tx) => loadInProgressEntries(tx, membershipId))

  return (
    <PageContainer>
      <div className="space-y-5">
        <GeneratedValue value={header} />

        <GeneratedValue
          value={
            entries.length === 0 ? (
              <EmptyState
                icon={<PencilLine size={32} />}
                title={tGenerated('m_03cdaafe508e1f')}
                description={tGenerated('m_1b464e6d5939e2')}
                action={
                  <Link href="/dashboard">
                    <Button variant="outline">
                      <GeneratedText id="m_132d746a8ad9a0" />
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                <GeneratedValue
                  value={entries.map((e) => {
                    const meta = KIND_META[e.kind]
                    return (
                      <Link
                        key={`${e.kind}-${e.id}`}
                        href={e.href as never}
                        className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                      >
                        {/* oversized ghost icon bleeding off the corner */}
                        <meta.icon
                          aria-hidden
                          strokeWidth={1.5}
                          className={cn(
                            'pointer-events-none absolute -right-6 -bottom-7 h-32 w-32 -rotate-12 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
                            meta.ghost,
                          )}
                        />
                        <div className="relative flex h-full flex-col">
                          <div className="flex items-center justify-between gap-3">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium',
                                meta.chip,
                              )}
                            >
                              <meta.icon size={14} />
                              <GeneratedValue value={meta.label} />
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              <GeneratedValue value={relativeTime(e.updatedAt, ctx.locale)} />
                            </span>
                          </div>
                          <div className="mt-4 line-clamp-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={e.title} />
                          </div>
                          <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-teal-700 dark:text-teal-300">
                            <GeneratedText id="m_0607d4d4be574c" />
                            <ArrowRight
                              size={14}
                              className="transition-transform group-hover:translate-x-0.5"
                            />
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                />
              </div>
            )
          }
        />
      </div>
    </PageContainer>
  )
}
