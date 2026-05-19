import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  AlertTriangle,
  Folder,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  Truck,
  Users,
} from 'lucide-react'
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
import {
  customerContacts,
  equipmentItems,
  equipmentTypes,
  incidents,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const CUSTOMER_TABS = [
  'overview',
  'projects',
  'sites',
  'contacts',
  'incidents',
  'equipment',
  'activity',
] as const
const PROJECT_TABS = [
  'overview',
  'sites',
  'contacts',
  'incidents',
  'equipment',
  'activity',
] as const
const SITE_TABS = ['overview', 'contacts', 'incidents', 'equipment', 'activity'] as const

type CustomerTab = (typeof CUSTOMER_TABS)[number]
type ProjectTab = (typeof PROJECT_TABS)[number]
type SiteTab = (typeof SITE_TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Location · ${id.slice(0, 8)}` }
}

// -------------------- Server actions --------------------

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

// -------------------- Helpers --------------------

/** Resolve the full descendant org-unit id set for a given root, walking the tree. */
async function resolveDescendantIds(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  rootId: string,
): Promise<string[]> {
  return ctx.db(async (tx) => {
    const result = new Set<string>([rootId])
    let frontier = [rootId]
    // Loop a bounded number of times to be safe.
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const children = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(inArray(orgUnits.parentId, frontier))
      const ids = children.map((c) => c.id)
      const next: string[] = []
      for (const id of ids) {
        if (!result.has(id)) {
          result.add(id)
          next.push(id)
        }
      }
      frontier = next
    }
    return Array.from(result)
  })
}

async function loadIncidentsForUnits(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  orgUnitIds: string[],
) {
  if (orgUnitIds.length === 0) return []
  return ctx.db((tx) =>
    tx
      .select()
      .from(incidents)
      .where(inArray(incidents.siteOrgUnitId, orgUnitIds))
      .orderBy(desc(incidents.occurredAt))
      .limit(100),
  )
}

async function loadEquipmentForUnits(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  orgUnitIds: string[],
) {
  if (orgUnitIds.length === 0) return []
  return ctx.db((tx) =>
    tx
      .select({ item: equipmentItems, type: equipmentTypes, holder: people })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(inArray(equipmentItems.currentSiteOrgUnitId, orgUnitIds))
      .orderBy(asc(equipmentItems.name))
      .limit(200),
  )
}

// -------------------- Page entry --------------------

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

  if (unit.level === 'customer') {
    return renderCustomer({ unit, children, sp, id, ctx })
  }
  if (unit.level === 'project') {
    return renderProject({ unit, parent, children, sp, id, ctx })
  }
  return renderSite({ unit, parent, sp, id, ctx })
}

// -------------------- Customer view --------------------

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

  const descendantIds = await resolveDescendantIds(ctx, id)
  const [allIncidents, allEquipment] = await Promise.all([
    loadIncidentsForUnits(ctx, descendantIds),
    loadEquipmentForUnits(ctx, descendantIds),
  ])

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
            <Link href={`${basePath}/edit` as any}>
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
            { key: 'incidents', label: 'Incidents', count: allIncidents.length },
            { key: 'equipment', label: 'Equipment', count: allEquipment.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}
      {active === 'projects' ? <ProjectsTab unit={unit} projects={projects} /> : null}
      {active === 'sites' ? <SitesTab sites={allSites} parentNameFor={projectParentName} /> : null}
      {active === 'contacts' ? <ContactsTab unit={unit} contacts={contacts} /> : null}
      {active === 'incidents' ? <IncidentsTab rows={allIncidents} /> : null}
      {active === 'equipment' ? <EquipmentTab equipment={allEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

// -------------------- Project view --------------------

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

  const contacts = await ctx.db((tx) =>
    tx
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.orgUnitId, id))
      .orderBy(asc(customerContacts.name)),
  )

  const descendantIds = await resolveDescendantIds(ctx, id)
  const [allIncidents, allEquipment] = await Promise.all([
    loadIncidentsForUnits(ctx, descendantIds),
    loadEquipmentForUnits(ctx, descendantIds),
  ])

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
            <Link href={`${basePath}/edit` as any}>
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
            { key: 'contacts', label: 'Contacts', count: contacts.length },
            { key: 'incidents', label: 'Incidents', count: allIncidents.length },
            { key: 'equipment', label: 'Equipment', count: allEquipment.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}
      {active === 'sites' ? <SitesTab sites={sites} /> : null}
      {active === 'contacts' ? <ContactsTab unit={unit} contacts={contacts} /> : null}
      {active === 'incidents' ? <IncidentsTab rows={allIncidents} /> : null}
      {active === 'equipment' ? <EquipmentTab equipment={allEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

// -------------------- Site view --------------------

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

  const contacts = await ctx.db((tx) =>
    tx
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.orgUnitId, id))
      .orderBy(asc(customerContacts.name)),
  )

  const [siteIncidents, siteEquipment] = await Promise.all([
    loadIncidentsForUnits(ctx, [id]),
    loadEquipmentForUnits(ctx, [id]),
  ])

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
            <Link href={`${basePath}/edit` as any}>
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
            { key: 'contacts', label: 'Contacts', count: contacts.length },
            { key: 'incidents', label: 'Incidents', count: siteIncidents.length },
            { key: 'equipment', label: 'Equipment', count: siteEquipment.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} /> : null}
      {active === 'contacts' ? <ContactsTab unit={unit} contacts={contacts} /> : null}
      {active === 'incidents' ? <IncidentsTab rows={siteIncidents} /> : null}
      {active === 'equipment' ? <EquipmentTab equipment={siteEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} /> : null}
    </DetailPageLayout>
  )
}

// ---------- Tab content components ----------

function OverviewTab({ unit }: { unit: typeof orgUnits.$inferSelect }) {
  const mapsHref =
    unit.lat != null && unit.lng != null
      ? `https://www.google.com/maps?q=${unit.lat},${unit.lng}`
      : null
  return (
    <div className="space-y-4">
      <DetailGrid
        rows={[
          { label: 'Name', value: unit.name },
          { label: 'Code', value: unit.code ?? '—' },
          { label: 'Level', value: unit.level },
          { label: 'Address', value: formatFullAddress(unit.address) ?? '—' },
          {
            label: 'Latitude',
            value: unit.lat != null ? unit.lat.toFixed(6) : '—',
          },
          {
            label: 'Longitude',
            value: unit.lng != null ? unit.lng.toFixed(6) : '—',
          },
          {
            label: 'Geofence',
            value: unit.geofenceMeters ? `${unit.geofenceMeters} m` : '—',
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map</CardTitle>
        </CardHeader>
        <CardContent>
          {unit.lat != null && unit.lng != null ? (
            <div className="space-y-3">
              <iframe
                title="OpenStreetMap"
                width="100%"
                height="320"
                loading="lazy"
                className="rounded-md border border-slate-200"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${(unit.lng - 0.005).toFixed(5)}%2C${(unit.lat - 0.003).toFixed(5)}%2C${(unit.lng + 0.005).toFixed(5)}%2C${(unit.lat + 0.003).toFixed(5)}&layer=mapnik&marker=${unit.lat}%2C${unit.lng}`}
              />
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  <MapPin size={12} className="-mt-0.5 mr-1 inline" />
                  {unit.lat.toFixed(5)}, {unit.lng.toFixed(5)}
                </span>
                {mapsHref ? (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-700 hover:underline"
                  >
                    Open in Google Maps →
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<MapPin size={24} />}
              title="No coordinates set"
              description="Edit the location to set latitude and longitude — site-level coordinates feed GPS auto-suggest in the field app."
            />
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
                  <Link
                    href={`/locations/${p.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
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
              <Link
                href={`/locations/${s.id}`}
                className="font-medium text-slate-900 hover:underline"
              >
                {s.name}
              </Link>
            </TableCell>
            {parentNameFor ? (
              <TableCell className="text-slate-600">{parentNameFor(s.parentId) ?? '—'}</TableCell>
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
                    <a
                      href={`mailto:${c.email}`}
                      className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                    >
                      <Mail size={12} /> {c.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-slate-600">
                  {c.phone ? (
                    <a
                      href={`tel:${c.phone}`}
                      className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                    >
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

function IncidentsTab({ rows }: { rows: (typeof incidents.$inferSelect)[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle size={32} />}
        title="No incidents recorded"
        description="Incidents reported at sites under this location appear here."
        action={
          <Link href={`/incidents/new`}>
            <Button variant="outline" size="sm">
              Report an incident →
            </Button>
          </Link>
        }
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ref</TableHead>
          <TableHead>Occurred</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((i) => (
          <TableRow key={i.id}>
            <TableCell className="font-mono text-xs">
              <Link href={`/incidents/${i.id}`} className="hover:underline">
                {i.reference}
              </Link>
            </TableCell>
            <TableCell>{new Date(i.occurredAt).toLocaleDateString()}</TableCell>
            <TableCell>{i.title}</TableCell>
            <TableCell>
              <Badge variant={severityVariant(i.severity)}>{i.severity}</Badge>
            </TableCell>
            <TableCell className="text-slate-600">{i.status.replace(/_/g, ' ')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function EquipmentTab({
  equipment,
}: {
  equipment: {
    item: typeof equipmentItems.$inferSelect
    type: typeof equipmentTypes.$inferSelect | null
    holder: typeof people.$inferSelect | null
  }[]
}) {
  if (equipment.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={32} />}
        title="No equipment at this location"
        description="Equipment currently held at sites under this location appears here."
        action={
          <Link href={`/equipment`}>
            <Button variant="outline" size="sm">
              Browse equipment →
            </Button>
          </Link>
        }
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset tag</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Holder</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {equipment.map((row) => (
          <TableRow key={row.item.id}>
            <TableCell className="font-mono text-xs">{row.item.assetTag}</TableCell>
            <TableCell className="font-medium">{row.item.name}</TableCell>
            <TableCell className="text-slate-600">{row.type?.name ?? '—'}</TableCell>
            <TableCell className="text-slate-600">
              {row.holder ? (
                <Link
                  href={`/people/${row.holder.id}`}
                  className="text-teal-700 hover:underline"
                >
                  {row.holder.firstName} {row.holder.lastName}
                </Link>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>
              <Badge variant={row.item.status === 'in_service' ? 'success' : 'warning'}>
                {row.item.status.replace('_', ' ')}
              </Badge>
            </TableCell>
            <TableCell>
              <Link
                href={`/equipment/${row.item.id}`}
                className="text-xs text-teal-700 hover:underline"
              >
                View →
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ---------- Helpers ----------

function severityVariant(s: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (s === 'fatality' || s === 'lost_time') return 'destructive'
  if (s === 'medical_aid') return 'warning'
  if (s === 'first_aid_only') return 'secondary'
  return 'secondary'
}

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
