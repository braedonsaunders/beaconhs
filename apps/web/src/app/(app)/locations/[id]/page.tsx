import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Folder, Mail, MapPin, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { customerContacts, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const CUSTOMER_TABS = ['overview', 'projects', 'sites', 'contacts', 'activity'] as const
const PROJECT_TABS = ['overview', 'sites', 'activity'] as const
const SITE_TABS = ['overview', 'activity'] as const

type CustomerTab = (typeof CUSTOMER_TABS)[number]
type ProjectTab = (typeof PROJECT_TABS)[number]
type SiteTab = (typeof SITE_TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Location · ${id.slice(0, 8)}` }
}

async function addContact(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const orgUnitId = String(formData.get('orgUnitId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const role = String(formData.get('role') ?? '').trim() || null
  const email = String(formData.get('email') ?? '').trim() || null
  const phone = String(formData.get('phone') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const isPrimary = formData.get('isPrimary') === 'on'
  if (!orgUnitId || !name) return

  const [row] = await ctx.db((tx) =>
    tx
      .insert(customerContacts)
      .values({ tenantId: ctx.tenantId, orgUnitId, name, role, email, phone, notes, isPrimary })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'customer_contact',
      entityId: row.id,
      action: 'create',
      summary: `Added contact "${name}"`,
      after: { name, role, email, phone, isPrimary, orgUnitId },
    })
  }
  revalidatePath(`/locations/${orgUnitId}`)
}

async function deleteContact(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const orgUnitId = String(formData.get('orgUnitId') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [c] = await tx.select().from(customerContacts).where(eq(customerContacts.id, id)).limit(1)
    return c
  })
  await ctx.db((tx) => tx.delete(customerContacts).where(eq(customerContacts.id, id)))
  await recordAudit(ctx, {
    entityType: 'customer_contact',
    entityId: id,
    action: 'delete',
    summary: before ? `Removed contact "${before.name}"` : 'Removed contact',
    before: before as unknown as Record<string, unknown>,
  })
  if (orgUnitId) revalidatePath(`/locations/${orgUnitId}`)
}

export default async function LocationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    if (!unit) return null

    const [parent] = unit.parentId
      ? await tx.select().from(orgUnits).where(eq(orgUnits.id, unit.parentId)).limit(1)
      : [null]

    const children = await tx
      .select()
      .from(orgUnits)
      .where(eq(orgUnits.parentId, id))
      .orderBy(asc(orgUnits.name))

    return { unit, parent, children }
  })

  if (!data) notFound()
  const { unit, parent, children } = data

  // Customer view
  if (unit.level === 'customer') {
    return renderCustomer({ unit, children, sp, id, ctx })
  }
  // Project view
  if (unit.level === 'project') {
    return renderProject({ unit, parent, children, sp, id, ctx })
  }
  // Site / area view
  return renderSite({ unit, parent, sp, id, ctx })
}

async function renderCustomer({
  unit,
  children,
  sp,
  id,
  ctx,
}: {
  unit: typeof orgUnits.$inferSelect
  children: (typeof orgUnits.$inferSelect)[]
  sp: Record<string, string | string[] | undefined>
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const active: CustomerTab = pickActiveTab(sp, CUSTOMER_TABS, 'overview')
  const basePath = `/locations/${id}`

  const projects = children.filter((c) => c.level === 'project')

  // All sites under the customer: direct children that are sites + sites under each project.
  const allSites = await ctx.db(async (tx) => {
    const direct = children.filter((c) => c.level === 'site')
    const projectIds = projects.map((p) => p.id)
    let nested: (typeof orgUnits.$inferSelect)[] = []
    if (projectIds.length > 0) {
      nested = await tx
        .select()
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), inArray(orgUnits.parentId, projectIds)))
        .orderBy(asc(orgUnits.name))
    }
    return [...direct, ...nested]
  })

  const contacts = await ctx.db((tx) =>
    tx
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.orgUnitId, id))
      .orderBy(asc(customerContacts.name)),
  )

  const activity = active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const projectParentName = (siteParentId: string | null): string | undefined => {
    if (!siteParentId) return undefined
    const p = projects.find((pr) => pr.id === siteParentId)
    return p?.name
  }

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/locations', label: 'Back to locations' }}
          title={unit.name}
          subtitle={unit.code ? `Customer · ${unit.code}` : 'Customer'}
          badge={<Badge variant="secondary">customer</Badge>}
          actions={
            <Link href={`${basePath}/edit`}>
              <Button variant="outline">
                <Pencil size={14} /> Edit
              </Button>
            </Link>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'projects', label: 'Projects', count: projects.length },
            { key: 'sites', label: 'Sites', count: allSites.length },
            { key: 'contacts', label: 'Contacts', count: contacts.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}

      {active === 'projects' ? (
        <ProjectsTab unit={unit} projects={projects} />
      ) : null}

      {active === 'sites' ? (
        <SitesTab sites={allSites} parentNameFor={projectParentName} />
      ) : null}

      {active === 'contacts' ? (
        <ContactsTab unit={unit} contacts={contacts} />
      ) : null}

      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

async function renderProject({
  unit,
  parent,
  children,
  sp,
  id,
  ctx,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  children: (typeof orgUnits.$inferSelect)[]
  sp: Record<string, string | string[] | undefined>
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const active: ProjectTab = pickActiveTab(sp, PROJECT_TABS, 'overview')
  const basePath = `/locations/${id}`
  const sites = children.filter((c) => c.level === 'site')
  const activity = active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=projects` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={unit.name}
          subtitle={parent ? `Project under ${parent.name}` : 'Project'}
          badge={<Badge variant="secondary">project</Badge>}
          actions={
            <Link href={`${basePath}/edit`}>
              <Button variant="outline">
                <Pencil size={14} /> Edit
              </Button>
            </Link>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'sites', label: 'Sites', count: sites.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}

      {active === 'sites' ? <SitesTab sites={sites} /> : null}

      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

async function renderSite({
  unit,
  parent,
  sp,
  id,
  ctx,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  sp: Record<string, string | string[] | undefined>
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const active: SiteTab = pickActiveTab(sp, SITE_TABS, 'overview')
  const basePath = `/locations/${id}`
  const activity = active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=sites` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={unit.name}
          subtitle={parent ? `${unit.level} under ${parent.name}` : unit.level}
          badge={<Badge variant="secondary">{unit.level}</Badge>}
          actions={
            <Link href={`${basePath}/edit`}>
              <Button variant="outline">
                <Pencil size={14} /> Edit
              </Button>
            </Link>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

// ---------- Tab content components ----------

function OverviewTab({ unit }: { unit: typeof orgUnits.$inferSelect }) {
  return (
    <div className="space-y-4">
      <DetailGrid
        rows={[
          { label: 'Name', value: unit.name },
          { label: 'Code', value: unit.code ?? '—' },
          { label: 'Level', value: unit.level },
          { label: 'Address', value: formatFullAddress(unit.address) ?? '—' },
          { label: 'Latitude', value: unit.lat != null ? unit.lat.toFixed(6) : '—' },
          { label: 'Longitude', value: unit.lng != null ? unit.lng.toFixed(6) : '—' },
          { label: 'Geofence', value: unit.geofenceMeters ? `${unit.geofenceMeters} m` : '—' },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map</CardTitle>
        </CardHeader>
        <CardContent>
          {unit.lat != null && unit.lng != null ? (
            <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              <div className="flex flex-col items-center gap-1">
                <MapPin size={20} className="text-slate-400" />
                <span>
                  {unit.lat.toFixed(5)}, {unit.lng.toFixed(5)}
                </span>
                <span className="text-xs">Map placeholder</span>
              </div>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              No coordinates set.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProjectsTab({
  unit,
  projects,
}: {
  unit: typeof orgUnits.$inferSelect
  projects: (typeof orgUnits.$inferSelect)[]
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link href={`/locations/${unit.id}/projects/new`}>
          <Button>
            <Plus size={14} /> Add project
          </Button>
        </Link>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={<Folder size={32} />}
          title="No projects yet"
          description="Create a project to group sites for this customer."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Code</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/locations/${p.id}`} className="font-medium text-slate-900 hover:underline">
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-600">{p.code ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/locations/${p.id}`} className="text-xs text-teal-700 hover:underline">
                    View →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function SitesTab({
  sites,
  parentNameFor,
}: {
  sites: (typeof orgUnits.$inferSelect)[]
  parentNameFor?: (parentId: string | null) => string | undefined
}) {
  if (sites.length === 0) {
    return (
      <EmptyState
        icon={<MapPin size={32} />}
        title="No sites yet"
        description="Sites live underneath a project (or directly under a customer)."
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          {parentNameFor ? <TableHead>Project</TableHead> : null}
          <TableHead>Code</TableHead>
          <TableHead>Coordinates</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Link href={`/locations/${s.id}`} className="font-medium text-slate-900 hover:underline">
                {s.name}
              </Link>
            </TableCell>
            {parentNameFor ? (
              <TableCell className="text-slate-600">
                {parentNameFor(s.parentId) ?? '—'}
              </TableCell>
            ) : null}
            <TableCell className="font-mono text-xs text-slate-600">{s.code ?? '—'}</TableCell>
            <TableCell className="text-slate-600">
              {s.lat != null && s.lng != null
                ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
                : '—'}
            </TableCell>
            <TableCell className="text-right">
              <Link href={`/locations/${s.id}`} className="text-xs text-teal-700 hover:underline">
                View →
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ContactsTab({
  unit,
  contacts,
}: {
  unit: typeof orgUnits.$inferSelect
  contacts: (typeof customerContacts.$inferSelect)[]
}) {
  return (
    <div className="space-y-5">
      {contacts.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No contacts yet"
          description="Add a customer contact below — site managers, client reps, emergency-only contacts."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    {c.isPrimary ? (
                      <Badge variant="success" className="gap-1">
                        <Star size={10} /> Primary
                      </Badge>
                    ) : null}
                  </div>
                  {c.notes ? <div className="text-xs text-slate-500">{c.notes}</div> : null}
                </TableCell>
                <TableCell className="text-slate-600">{c.role ?? '—'}</TableCell>
                <TableCell className="text-slate-600">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                      <Mail size={12} /> {c.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-slate-600">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                      <Phone size={12} /> {c.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <form action={deleteContact} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="orgUnitId" value={unit.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add contact</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addContact} className="space-y-3">
            <input type="hidden" name="orgUnitId" value={unit.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" required>
                <Input name="name" required />
              </Field>
              <Field label="Role">
                <Input name="role" placeholder="e.g. Site Manager" />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" autoComplete="email" />
              </Field>
              <Field label="Phone">
                <Input name="phone" type="tel" autoComplete="tel" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea name="notes" rows={2} />
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="contact-is-primary"
                  type="checkbox"
                  name="isPrimary"
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <Label htmlFor="contact-is-primary" className="text-sm">
                  Mark as primary contact
                </Label>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit">
                <Plus size={14} /> Add contact
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Helpers ----------

function formatFullAddress(
  address:
    | {
        line1?: string
        line2?: string
        city?: string
        region?: string
        postal?: string
        country?: string
      }
    | null
    | undefined,
): string | null {
  if (!address) return null
  const parts = [
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(', ') || undefined,
    address.postal,
    address.country,
  ].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : null
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
