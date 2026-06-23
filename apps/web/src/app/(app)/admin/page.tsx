import Link from 'next/link'
import {
  ArrowUpRight,
  Boxes,
  Building2,
  Database,
  KeyRound,
  Mail,
  PanelLeft,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { AdminTileGrid } from '@/components/module-admin/admin-tile-grid'
import { MODULE_ADMIN } from '@/lib/module-admin/registry'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin' }

// Per-accent class sets. Kept as complete literal strings so Tailwind's scanner
// picks them up (dynamic `bg-${x}` names would be purged).
const ACCENTS = {
  teal: {
    chip: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/50 dark:text-teal-300',
    glow: 'text-teal-500',
    border: 'hover:border-teal-300 dark:hover:border-teal-700',
    link: 'group-hover:text-teal-700 dark:group-hover:text-teal-300',
  },
  violet: {
    chip: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-950/50 dark:text-violet-300',
    glow: 'text-violet-500',
    border: 'hover:border-violet-300 dark:hover:border-violet-700',
    link: 'group-hover:text-violet-700 dark:group-hover:text-violet-300',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/50 dark:text-amber-300',
    glow: 'text-amber-500',
    border: 'hover:border-amber-300 dark:hover:border-amber-700',
    link: 'group-hover:text-amber-700 dark:group-hover:text-amber-300',
  },
  sky: {
    chip: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/50 dark:text-sky-300',
    glow: 'text-sky-500',
    border: 'hover:border-sky-300 dark:hover:border-sky-700',
    link: 'group-hover:text-sky-700 dark:group-hover:text-sky-300',
  },
} as const

type Accent = keyof typeof ACCENTS

type Tile = {
  href: string
  icon: LucideIcon
  title: string
  desc: string
  badge?: string
}

type Group = { label: string; accent: Accent; tiles: Tile[] }

// Library & catalogues and Navigation used to live in the sidebar; they're now
// folded in here so the left nav stays lean and this page is the admin hub.
const GROUPS: Group[] = [
  {
    label: 'Organization',
    accent: 'teal',
    tiles: [
      {
        href: '/admin/users',
        icon: Users,
        title: 'Users',
        desc: 'Invite people, assign roles & scopes, override individual permissions.',
      },
      {
        href: '/admin/roles',
        icon: ShieldCheck,
        title: 'Roles & permissions',
        desc: 'Define roles and the permissions each one grants.',
      },
      {
        href: '/admin/org',
        icon: Building2,
        title: 'Org hierarchy',
        desc: 'Customers, projects, sites, areas, crews.',
      },
      {
        href: '/admin/tenants',
        icon: Boxes,
        title: 'Tenants',
        desc: 'List + view-as every tenant on this deployment.',
        badge: 'Super-admin',
      },
    ],
  },
  {
    label: 'Workspace',
    accent: 'violet',
    tiles: [
      {
        href: '/admin/settings',
        icon: SlidersHorizontal,
        title: 'Tenant settings',
        desc: 'Branding, languages, risk matrix, hierarchy depth.',
      },
      {
        href: '/admin/navigation',
        icon: PanelLeft,
        title: 'Navigation',
        desc: 'Reorder the sidebar, pin forms as native modules, hide unused sections.',
      },
      {
        href: '/admin/data-sources',
        icon: Database,
        title: 'Data sources',
        desc: 'Reference lists + live data your apps bind to — lookups, cascades, KPIs.',
      },
      {
        href: '/admin/email-templates',
        icon: Mail,
        title: 'Email templates',
        desc: 'Drag-and-drop branded emails that flows send (Send email → template).',
      },
    ],
  },
  {
    label: 'Integrations',
    accent: 'amber',
    tiles: [
      {
        href: '/admin/ai',
        icon: Sparkles,
        title: 'AI',
        desc: 'Provider, models and API key (encrypted) — powers journal AI.',
      },
      {
        href: '/admin/integrations',
        icon: RefreshCw,
        title: 'Integrations',
        desc: 'Sync people, locations & equipment from NetSuite, databases, CSVs and more.',
      },
      {
        href: '/admin/api-keys',
        icon: KeyRound,
        title: 'API keys',
        desc: 'Manage public REST API credentials.',
      },
    ],
  },
  {
    label: 'Activity',
    accent: 'sky',
    tiles: [
      {
        href: '/admin/audit',
        icon: ScrollText,
        title: 'Audit log',
        desc: 'Every write captured with actor + diffs.',
      },
      {
        href: '/admin/email-log',
        icon: Mail,
        title: 'Email log',
        desc: 'Every transactional + on-demand email the worker dispatched.',
      },
    ],
  },
]

export default async function AdminPage() {
  const ctx = await requireRequestContext()
  // Per-module administration, driven by the module-admin registry — one tile per
  // module the viewer may administer, linking to that module's Manage hub.
  const moduleTiles = MODULE_ADMIN.filter((m) => ctx.isSuperAdmin || can(ctx, m.permission)).map(
    (m) => ({
      key: m.moduleKey,
      label: m.label,
      href: m.managePath,
      iconKey: m.iconKey,
      desc: `Records, taxonomies & settings for ${m.label.toLowerCase()}.`,
    }),
  )

  return (
    <PageContainer>
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Admin</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Everything that configures this workspace — people, settings, integrations, and the
            audit trail.
          </p>
        </header>

        {moduleTiles.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
              Module administration
            </h2>
            <AdminTileGrid tiles={moduleTiles} />
          </section>
        ) : null}

        {GROUPS.map((group) => {
          const accent = ACCENTS[group.accent]
          return (
            <section key={group.label} className="space-y-3">
              <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.tiles.map((tile) => {
                  const Icon = tile.icon
                  return (
                    <Link
                      key={tile.href}
                      href={tile.href as any}
                      className={cn(
                        'group relative block overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
                        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
                        accent.border,
                      )}
                    >
                      {/* Oversized, faded backdrop icon. */}
                      <Icon
                        aria-hidden
                        strokeWidth={1.25}
                        className={cn(
                          'pointer-events-none absolute -right-4 -bottom-5 h-28 w-28 opacity-[0.07]',
                          'transition-opacity duration-200 group-hover:opacity-[0.12]',
                          accent.glow,
                        )}
                      />
                      <div className="relative flex items-start gap-3">
                        <span
                          className={cn(
                            'grid h-11 w-11 shrink-0 place-items-center rounded-lg ring-1',
                            accent.chip,
                          )}
                        >
                          <Icon size={20} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                              {tile.title}
                            </h3>
                            {tile.badge ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {tile.badge}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {tile.desc}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'relative mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors dark:text-slate-500',
                          accent.link,
                        )}
                      >
                        Open
                        <ArrowUpRight
                          size={13}
                          className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </PageContainer>
  )
}
