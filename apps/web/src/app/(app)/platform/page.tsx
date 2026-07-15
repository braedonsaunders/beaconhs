import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import Link from 'next/link'
import {
  Boxes,
  Database,
  Mail,
  MessageSquare,
  Plus,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react'
import { PageContainer } from '@/components/page-layout'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_05042d6e17b589') }
}
export const dynamic = 'force-dynamic'

type Tile = { href: string; title: string; desc: string; icon: React.ReactNode }

const TILES: Tile[] = [
  {
    href: '/platform/tenants',
    title: 'Tenants',
    desc: 'List, provision and view-as every tenant',
    icon: <Boxes size={18} />,
  },
  {
    href: '/platform/tenants/new',
    title: 'Create tenant',
    desc: 'Provision a new tenant + seed built-ins',
    icon: <Plus size={18} />,
  },
  {
    href: '/platform/users',
    title: 'Users',
    desc: 'Global identities + cross-tenant membership',
    icon: <Users size={18} />,
  },
  {
    href: '/platform/email',
    title: 'Platform email',
    desc: 'Global default provider + tenant policy',
    icon: <Mail size={18} />,
  },
  {
    href: '/platform/sms',
    title: 'Platform SMS',
    desc: 'Global default provider + tenant policy',
    icon: <MessageSquare size={18} />,
  },
  {
    href: '/platform/ai',
    title: 'Platform AI',
    desc: 'Global default provider + tenant policy',
    icon: <Sparkles size={18} />,
  },
  {
    href: '/platform/email-log',
    title: 'Email log',
    desc: 'Every email dispatched, across all tenants',
    icon: <ScrollText size={18} />,
  },
  {
    href: '/platform/sms-log',
    title: 'SMS log',
    desc: 'Every text dispatched, across all tenants',
    icon: <ScrollText size={18} />,
  },
  {
    href: '/platform/database',
    title: 'Database maintenance',
    desc: 'Retention windows + planner upkeep for high-volume tables',
    icon: <Database size={18} />,
  },
]

export default function PlatformHubPage() {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <PageContainer>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_05042d6e17b589" />
          </h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_02c5753f57f8c1" />
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <GeneratedValue
            value={TILES.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href as never}
                title={tGeneratedValue(tile.desc)}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-amber-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-amber-800/60"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/60">
                  <GeneratedValue value={tile.icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedValue value={tile.title} />
                  </h3>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={tile.desc} />
                  </p>
                </div>
              </Link>
            ))}
          />
        </div>
      </div>
    </PageContainer>
  )
}
