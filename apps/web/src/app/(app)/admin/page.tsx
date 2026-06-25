import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Bell,
  Building2,
  Database,
  FileText,
  KeyRound,
  Mail,
  PanelLeft,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { NavIcon } from '@/components/sidebar-nav'
import { MODULE_ADMIN } from '@/lib/module-admin/registry'
import { mergeHref, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin' }

// Per-accent class sets. Kept as complete literal strings so Tailwind's scanner
// picks them up (dynamic `bg-${x}` names would be purged).
const ACCENTS = {
  teal: {
    chip: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/50 dark:text-teal-300',
    border: 'hover:border-teal-300 dark:hover:border-teal-700',
    link: 'group-hover:text-teal-600 dark:group-hover:text-teal-300',
  },
  violet: {
    chip: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-950/50 dark:text-violet-300',
    border: 'hover:border-violet-300 dark:hover:border-violet-700',
    link: 'group-hover:text-violet-600 dark:group-hover:text-violet-300',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/50 dark:text-amber-300',
    border: 'hover:border-amber-300 dark:hover:border-amber-700',
    link: 'group-hover:text-amber-600 dark:group-hover:text-amber-300',
  },
  sky: {
    chip: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/50 dark:text-sky-300',
    border: 'hover:border-sky-300 dark:hover:border-sky-700',
    link: 'group-hover:text-sky-600 dark:group-hover:text-sky-300',
  },
} as const

type Accent = keyof typeof ACCENTS
type Tile = { href: string; title: string; desc: string; badge?: string; icon: ReactNode }
type Group = { key: string; label: string; accent: Accent; tiles: Tile[] }

// Library & catalogues and Navigation used to live in the sidebar; they're now
// folded in here so the left nav stays lean and this page is the admin hub.
const STATIC_GROUPS: Group[] = [
  {
    key: 'organization',
    label: 'Organization',
    accent: 'teal',
    tiles: [
      {
        href: '/admin/users',
        icon: <Users size={18} />,
        title: 'Users',
        desc: 'Invite people, assign roles & scopes',
      },
      {
        href: '/admin/roles',
        icon: <ShieldCheck size={18} />,
        title: 'Roles & permissions',
        desc: 'Define roles and what they grant',
      },
      {
        href: '/admin/org',
        icon: <Building2 size={18} />,
        title: 'Org hierarchy',
        desc: 'Customers, projects, sites, areas, crews',
      },
    ],
  },
  {
    key: 'workspace',
    label: 'Workspace',
    accent: 'violet',
    tiles: [
      {
        href: '/admin/settings',
        icon: <SlidersHorizontal size={18} />,
        title: 'Tenant settings',
        desc: 'Branding, languages, risk matrix, hierarchy',
      },
      {
        href: '/admin/notifications',
        icon: <Bell size={18} />,
        title: 'Notifications',
        desc: 'Who gets automatic alerts & how often reminders repeat',
      },
      {
        href: '/admin/navigation',
        icon: <PanelLeft size={18} />,
        title: 'Navigation',
        desc: 'Reorder the sidebar, pin forms as modules',
      },
      {
        href: '/admin/data-sources',
        icon: <Database size={18} />,
        title: 'Data sources',
        desc: 'Reference lists & live data your apps bind to',
      },
      {
        href: '/admin/email-templates',
        icon: <Mail size={18} />,
        title: 'Email templates',
        desc: 'Drag-and-drop branded emails for flows',
      },
      {
        href: '/admin/pdf-templates',
        icon: <FileText size={18} />,
        title: 'PDF templates',
        desc: 'Paper-size documents (Paged.js preview) flows attach',
      },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    accent: 'amber',
    tiles: [
      {
        href: '/admin/ai',
        icon: <Sparkles size={18} />,
        title: 'AI',
        desc: 'Provider, models & encrypted API key',
      },
      {
        href: '/admin/email',
        icon: <Mail size={18} />,
        title: 'Email',
        desc: 'Provider, sender & encrypted credentials',
      },
      {
        href: '/admin/integrations',
        icon: <RefreshCw size={18} />,
        title: 'Integrations',
        desc: 'Sync people, locations & equipment in',
      },
      {
        href: '/admin/api-keys',
        icon: <KeyRound size={18} />,
        title: 'API keys',
        desc: 'Public REST API credentials',
      },
    ],
  },
  {
    key: 'activity',
    label: 'Activity',
    accent: 'sky',
    tiles: [
      {
        href: '/admin/audit',
        icon: <ScrollText size={18} />,
        title: 'Audit log',
        desc: 'Every write captured with actor + diffs',
      },
      {
        href: '/admin/email-log',
        icon: <Mail size={18} />,
        title: 'Email log',
        desc: 'Every email the worker dispatched',
      },
    ],
  },
]

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const activeCat = pickString(sp.cat) ?? 'all'
  const query = (pickString(sp.q) ?? '').trim().toLowerCase()

  // Per-module administration, driven by the module-admin registry — one tile per
  // module the viewer may administer, linking to that module's Manage hub.
  const moduleTiles: Tile[] = MODULE_ADMIN.filter(
    (m) => ctx.isSuperAdmin || can(ctx, m.permission),
  ).map((m) => ({
    href: m.managePath,
    title: m.label,
    desc: 'Records, taxonomies & settings',
    icon: <NavIcon iconKey={m.iconKey} size={18} />,
  }))

  const allGroups: Group[] = [
    ...(moduleTiles.length
      ? [{ key: 'modules', label: 'Modules', accent: 'teal', tiles: moduleTiles } as Group]
      : []),
    ...STATIC_GROUPS,
  ]

  // Pills filter to a category; search narrows within the visible scope.
  const matches = (t: Tile) => !query || `${t.title} ${t.desc}`.toLowerCase().includes(query)
  const visibleGroups = allGroups
    .filter((g) => activeCat === 'all' || g.key === activeCat)
    .map((g) => ({ ...g, tiles: g.tiles.filter(matches) }))
    .filter((g) => g.tiles.length > 0)

  const basePath = '/admin'
  const categories = [
    { key: 'all', label: 'All' },
    ...allGroups.map((g) => ({ key: g.key, label: g.label })),
  ]

  return (
    <PageContainer>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Admin</h1>
            <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Everything that configures this workspace.
            </p>
          </div>
          <SearchInput placeholder="Search settings…" />
        </header>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const active = activeCat === c.key
            return (
              <Link
                key={c.key}
                href={mergeHref(basePath, sp, {
                  cat: c.key === 'all' ? undefined : c.key,
                  q: undefined,
                })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60',
                )}
              >
                {c.label}
              </Link>
            )
          })}
        </div>

        {visibleGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No settings match “{query}”.
          </p>
        ) : (
          visibleGroups.map((group) => {
            const accent = ACCENTS[group.accent]
            return (
              <section key={group.key} className="space-y-2.5">
                <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                  {group.label}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {group.tiles.map((tile) => (
                    <Link
                      key={tile.href}
                      href={tile.href as never}
                      title={tile.desc}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900',
                        accent.border,
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-10 w-10 shrink-0 place-items-center rounded-lg ring-1',
                          accent.chip,
                        )}
                      >
                        {tile.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {tile.title}
                          </h3>
                          {tile.badge ? (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {tile.badge}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {tile.desc}
                        </p>
                      </div>
                      <ArrowUpRight
                        size={15}
                        aria-hidden
                        className={cn(
                          'shrink-0 text-slate-300 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 dark:text-slate-600',
                          accent.link,
                        )}
                      />
                    </Link>
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </PageContainer>
  )
}
