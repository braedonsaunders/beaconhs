import Link from 'next/link'
import { notFound } from 'next/navigation'
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
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  customerContacts,
  equipmentItems,
  equipmentTypes,
  incidents,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { getTenantHierarchy, levelLabel, type TenantHierarchy } from '@/lib/org-hierarchy'
import { ActivityFeed } from '@/components/activity-feed'
import { LiveField } from '@/components/live-field'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  archiveLocation,
  createContactFromDrawer,
  createProject,
  deleteContact,
  restoreLocation,
  updateContactFromDrawer,
  updateLocationField,
} from '../_actions/locations'
import { ContactDrawer, type ContactRow } from './_drawers'

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
  return ctx.db(async (tx) => {
    // Honor the viewer's incidents read tier — the same predicate the
    // /incidents list applies, so this tab can't be used to enumerate
    // incidents the viewer couldn't otherwise see.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'incidents',
      ownerCols: [incidents.reportedByTenantUserId],
      siteCol: incidents.siteOrgUnitId,
    })
    return tx
      .select()
      .from(incidents)
      .where(
        and(
          inArray(incidents.siteOrgUnitId, orgUnitIds),
          isNull(incidents.deletedAt),
          ...(vis ? [vis] : []),
        ),
      )
      .orderBy(desc(incidents.occurredAt))
      .limit(100)
  })
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
  const drawer = typeof sp.drawer === 'string' ? sp.drawer : null
  const editContactId = typeof sp.contactId === 'string' ? sp.contactId : null
  const ctx = await requireRequestContext()
  const hierarchy = await getTenantHierarchy(ctx.tenantId)
  // Read-only unless the viewer can manage the org tree. The autosave / write
  // actions re-assert this server-side; this only gates the inputs and
  // affordances.
  const canManage = can(ctx, 'admin.org.manage') || ctx.isSuperAdmin

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
    return renderCustomer({
      unit,
      children,
      sp,
      drawer,
      editContactId,
      id,
      ctx,
      hierarchy,
      canManage,
    })
  }
  if (unit.level === 'project') {
    return renderProject({
      unit,
      parent,
      children,
      sp,
      drawer,
      editContactId,
      id,
      ctx,
      hierarchy,
      canManage,
    })
  }
  return renderSite({ unit, parent, sp, drawer, editContactId, id, ctx, canManage })
}

// -------------------- Customer view --------------------

async function renderCustomer({
  unit,
  children,
  sp,
  drawer,
  editContactId,
  id,
  ctx,
  hierarchy,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  children: (typeof orgUnits.$inferSelect)[]
  sp: Record<string, string | string[] | undefined>
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  hierarchy: TenantHierarchy
  canManage: boolean
}) {
  // Drop levels this tenant has switched off so a disabled depth can't be
  // reached even via a hand-edited ?tab= URL.
  const visibleTabs = CUSTOMER_TABS.filter(
    (t) => (t !== 'projects' || hierarchy.project) && (t !== 'sites' || hierarchy.site),
  )
  const active: CustomerTab = pickActiveTab(sp, visibleTabs, 'overview')
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

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

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
          subtitle={unit.code ? `${levelLabel('customer')} · ${unit.code}` : levelLabel('customer')}
          badge={
            <>
              <Badge variant="secondary">{levelLabel('customer')}</Badge>
              {unit.deletedAt ? <Badge variant="warning">Archived</Badge> : null}
            </>
          }
          actions={
            canManage ? (
              unit.deletedAt ? (
                <form action={restoreLocation}>
                  <input type="hidden" name="id" value={unit.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Restore
                  </Button>
                </form>
              ) : (
                <form action={archiveLocation}>
                  <input type="hidden" name="id" value={unit.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Archive
                  </Button>
                </form>
              )
            ) : undefined
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            {
              key: 'projects',
              label: 'Projects',
              count: projects.length,
              hidden: !hierarchy.project,
            },
            { key: 'sites', label: 'Sites', count: allSites.length, hidden: !hierarchy.site },
            { key: 'contacts', label: 'Contacts', count: contacts.length },
            { key: 'incidents', label: 'Incidents', count: allIncidents.length },
            { key: 'equipment', label: 'Equipment', count: allEquipment.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null}
      {active === 'projects' ? (
        <ProjectsTab unit={unit} projects={projects} canManage={canManage} />
      ) : null}
      {active === 'sites' ? <SitesTab sites={allSites} parentNameFor={projectParentName} /> : null}
      {active === 'contacts' ? (
        <ContactsTab unit={unit} contacts={contacts} canManage={canManage} />
      ) : null}
      {active === 'incidents' ? <IncidentsTab rows={allIncidents} timeZone={ctx.timezone} /> : null}
      {active === 'equipment' ? <EquipmentTab equipment={allEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} timeZone={ctx.timezone} /> : null}
      {canManage ? (
        <ContactDrawer
          open={drawer === 'new-contact' || drawer === 'edit-contact'}
          orgUnitId={id}
          contact={resolveEditContact(contacts, drawer, editContactId)}
          closeHref={`${basePath}?tab=contacts`}
          createAction={createContactFromDrawer}
          updateAction={updateContactFromDrawer}
        />
      ) : null}
    </DetailPageLayout>
  )
}

// -------------------- Project view --------------------

async function renderProject({
  unit,
  parent,
  children,
  sp,
  drawer,
  editContactId,
  id,
  ctx,
  hierarchy,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  children: (typeof orgUnits.$inferSelect)[]
  sp: Record<string, string | string[] | undefined>
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  hierarchy: TenantHierarchy
  canManage: boolean
}) {
  const visibleTabs = PROJECT_TABS.filter((t) => t !== 'sites' || hierarchy.site)
  const active: ProjectTab = pickActiveTab(sp, visibleTabs, 'overview')
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

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=projects` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={unit.name}
          subtitle={
            parent ? `${levelLabel('project')} under ${parent.name}` : levelLabel('project')
          }
          badge={<Badge variant="secondary">{levelLabel('project')}</Badge>}
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'sites', label: 'Sites', count: sites.length, hidden: !hierarchy.site },
            { key: 'contacts', label: 'Contacts', count: contacts.length },
            { key: 'incidents', label: 'Incidents', count: allIncidents.length },
            { key: 'equipment', label: 'Equipment', count: allEquipment.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null}
      {active === 'sites' ? <SitesTab sites={sites} /> : null}
      {active === 'contacts' ? (
        <ContactsTab unit={unit} contacts={contacts} canManage={canManage} />
      ) : null}
      {active === 'incidents' ? <IncidentsTab rows={allIncidents} timeZone={ctx.timezone} /> : null}
      {active === 'equipment' ? <EquipmentTab equipment={allEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} timeZone={ctx.timezone} /> : null}
      {canManage ? (
        <ContactDrawer
          open={drawer === 'new-contact' || drawer === 'edit-contact'}
          orgUnitId={id}
          contact={resolveEditContact(contacts, drawer, editContactId)}
          closeHref={`${basePath}?tab=contacts`}
          createAction={createContactFromDrawer}
          updateAction={updateContactFromDrawer}
        />
      ) : null}
    </DetailPageLayout>
  )
}

// -------------------- Site view --------------------

async function renderSite({
  unit,
  parent,
  sp,
  drawer,
  editContactId,
  id,
  ctx,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  sp: Record<string, string | string[] | undefined>
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  canManage: boolean
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

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=sites` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={unit.name}
          subtitle={
            parent ? `${levelLabel(unit.level)} under ${parent.name}` : levelLabel(unit.level)
          }
          badge={<Badge variant="secondary">{levelLabel(unit.level)}</Badge>}
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
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
      {active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null}
      {active === 'contacts' ? (
        <ContactsTab unit={unit} contacts={contacts} canManage={canManage} />
      ) : null}
      {active === 'incidents' ? (
        <IncidentsTab rows={siteIncidents} timeZone={ctx.timezone} />
      ) : null}
      {active === 'equipment' ? <EquipmentTab equipment={siteEquipment} /> : null}
      {active === 'activity' ? <ActivityFeed entries={activity} timeZone={ctx.timezone} /> : null}
      {canManage ? (
        <ContactDrawer
          open={drawer === 'new-contact' || drawer === 'edit-contact'}
          orgUnitId={id}
          contact={resolveEditContact(contacts, drawer, editContactId)}
          closeHref={`${basePath}?tab=contacts`}
          createAction={createContactFromDrawer}
          updateAction={updateContactFromDrawer}
        />
      ) : null}
    </DetailPageLayout>
  )
}

// ---------- Tab content components ----------

/** Find the contact targeted by ?drawer=edit-contact&contactId=… for prefill. */
function resolveEditContact(
  contacts: (typeof customerContacts.$inferSelect)[],
  drawer: string | null,
  contactId: string | null,
): ContactRow | null {
  if (drawer !== 'edit-contact' || !contactId) return null
  const c = contacts.find((row) => row.id === contactId)
  if (!c) return null
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    isPrimary: c.isPrimary,
  }
}

async function OverviewTab({
  unit,
  canManage,
  ctx,
}: {
  unit: typeof orgUnits.$inferSelect
  canManage: boolean
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const addr = unit.address ?? {}
  const mapsHref =
    unit.lat != null && unit.lng != null
      ? `https://www.google.com/maps?q=${unit.lat},${unit.lng}`
      : null
  return (
    <div className="space-y-4">
      <Section title="Location details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="name"
              label="Name"
              initialValue={unit.name}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <LiveField
            id={unit.id}
            field="code"
            label="Code"
            initialValue={unit.code}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <Section title="Address">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="addressLine1"
              label="Address line 1"
              initialValue={addr.line1 ?? null}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="addressLine2"
              label="Address line 2"
              initialValue={addr.line2 ?? null}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <LiveField
            id={unit.id}
            field="addressCity"
            label="City"
            initialValue={addr.city ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressRegion"
            label="Region / Province"
            initialValue={addr.region ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressPostal"
            label="Postal / Zip"
            initialValue={addr.postal ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressCountry"
            label="Country"
            initialValue={addr.country ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <Section title="Geolocation">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <LiveField
            id={unit.id}
            field="lat"
            label="Latitude"
            type="number"
            initialValue={unit.lat != null ? String(unit.lat) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="lng"
            label="Longitude"
            type="number"
            initialValue={unit.lng != null ? String(unit.lng) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="geofenceMeters"
            label="Geofence (m)"
            type="number"
            initialValue={unit.geofenceMeters != null ? String(unit.geofenceMeters) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <CustomFieldsSection
        ctx={ctx}
        entityKind="location"
        recordId={unit.id}
        subtypeId={null}
        metadata={unit.metadata}
        locked={!canManage}
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
              description="Set latitude and longitude above — site-level coordinates feed GPS auto-suggest in the field app."
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
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  projects: (typeof orgUnits.$inferSelect)[]
  canManage: boolean
}) {
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex items-center justify-end">
          <form action={createProject}>
            <input type="hidden" name="parentId" value={unit.id} />
            <Button type="submit">
              <Plus size={14} /> Add project
            </Button>
          </form>
        </div>
      ) : null}
      {projects.length === 0 ? (
        <EmptyState
          icon={<Folder size={32} />}
          title="No projects"
          description="Create a project to group sites for this location."
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
            {[...projects]
              .sort((a, b) => (a.deletedAt ? 1 : 0) - (b.deletedAt ? 1 : 0))
              .map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/locations/${p.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {p.name}
                      </Link>
                      {p.deletedAt ? <Badge variant="warning">Archived</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {p.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/locations/${p.id}`}
                      className="text-xs text-teal-700 hover:underline"
                    >
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
        title="No sites"
        description="Sites sit under a project or directly under a location."
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
              {s.lat != null && s.lng != null ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : '—'}
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
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  contacts: (typeof customerContacts.$inferSelect)[]
  canManage: boolean
}) {
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex items-center justify-end">
          <Link href={`/locations/${unit.id}?tab=contacts&drawer=new-contact`}>
            <Button>
              <Plus size={14} /> Add contact
            </Button>
          </Link>
        </div>
      ) : null}
      {contacts.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No contacts"
          description="Add a contact — site managers, client reps, emergency-only contacts."
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
                  {canManage ? (
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/locations/${unit.id}?tab=contacts&drawer=edit-contact&contactId=${c.id}`}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={14} />
                        </Button>
                      </Link>
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
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function IncidentsTab({
  rows,
  timeZone,
}: {
  rows: (typeof incidents.$inferSelect)[]
  timeZone: string
}) {
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
            <TableCell>{formatDate(new Date(i.occurredAt), timeZone)}</TableCell>
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
                <Link href={`/people/${row.holder.id}`} className="text-teal-700 hover:underline">
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
