import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, desc, eq } from 'drizzle-orm'
import { Activity, AlertTriangle, LogOut, UserPlus, Wind } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  UrlDrawer,
} from '@beaconhs/ui'
import { pickString } from '@/lib/list-params'
import {
  csAtmosphericReadings,
  csPermitPersonnel,
  csPermits,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const CS_TABS = ['overview', 'readings', 'personnel', 'activity'] as const
type CsTab = (typeof CS_TABS)[number]

const PERSONNEL_ROLES = ['entrant', 'attendant', 'supervisor', 'rescue'] as const

// ---------- Server actions ----------

async function closePermit(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(csPermits)
      .set({ status: 'closed', closedAt: new Date(), closedByTenantUserId: ctx.membership?.id })
      .where(eq(csPermits.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: id,
    action: 'update',
    summary: 'Permit closed',
  })
  revalidatePath(`/confined-space/${id}`)
  revalidatePath('/confined-space')
}

async function activatePermit(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.update(csPermits).set({ status: 'active' }).where(eq(csPermits.id, id)))
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: id,
    action: 'update',
    summary: 'Permit activated',
  })
  revalidatePath(`/confined-space/${id}`)
}

async function addReading(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const permitId = String(formData.get('permitId') ?? '')
  const oxygenPct = Number(formData.get('oxygenPct')) || null
  const lelPct = Number(formData.get('lelPct')) || null
  const h2sPpm = Number(formData.get('h2sPpm')) || null
  const coPpm = Number(formData.get('coPpm')) || null
  const sensorIdentifier = String(formData.get('sensorIdentifier') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null

  const outOfSpec =
    (oxygenPct !== null && (oxygenPct < 19.5 || oxygenPct > 23)) ||
    (lelPct !== null && lelPct >= 10) ||
    (h2sPpm !== null && h2sPpm >= 10) ||
    (coPpm !== null && coPpm >= 25)

  await ctx.db((tx) =>
    tx.insert(csAtmosphericReadings).values({
      tenantId: ctx.tenantId,
      permitId,
      recordedByTenantUserId: ctx.membership?.id,
      oxygenPct,
      lelPct,
      h2sPpm,
      coPpm,
      sensorIdentifier,
      note,
      outOfSpec: outOfSpec ? 1 : 0,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: permitId,
    action: 'update',
    summary: outOfSpec ? 'Atmospheric reading: OUT OF SPEC' : 'Atmospheric reading logged',
    after: { oxygenPct, lelPct, h2sPpm, coPpm },
  })
  revalidatePath(`/confined-space/${permitId}`)
  redirect(`/confined-space/${permitId}?tab=readings`)
}

async function addPersonnel(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const permitId = String(formData.get('permitId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  const role = String(formData.get('role') ?? '') as (typeof PERSONNEL_ROLES)[number]
  const markEntered = formData.get('markEntered') === 'on'
  const note = String(formData.get('note') ?? '').trim() || null

  if (!permitId || !personId || !PERSONNEL_ROLES.includes(role)) return

  await ctx.db((tx) =>
    tx.insert(csPermitPersonnel).values({
      tenantId: ctx.tenantId,
      permitId,
      personId,
      role,
      enteredAt: markEntered ? new Date() : null,
      note,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: permitId,
    action: 'update',
    summary: `Added ${role} to permit`,
    after: { personId, role, entered: markEntered },
  })
  revalidatePath(`/confined-space/${permitId}`)
  redirect(`/confined-space/${permitId}?tab=personnel`)
}

async function markEntered(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const permitId = String(formData.get('permitId') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(csPermitPersonnel).set({ enteredAt: new Date() }).where(eq(csPermitPersonnel.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: permitId,
    action: 'update',
    summary: 'Personnel entered space',
    after: { personnelId: id },
  })
  if (permitId) revalidatePath(`/confined-space/${permitId}`)
}

async function markExited(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const permitId = String(formData.get('permitId') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(csPermitPersonnel).set({ exitedAt: new Date() }).where(eq(csPermitPersonnel.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'cs_permit',
    entityId: permitId,
    action: 'update',
    summary: 'Personnel exited space',
    after: { personnelId: id },
  })
  if (permitId) revalidatePath(`/confined-space/${permitId}`)
}

// ---------- Page ----------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Permit · ${id.slice(0, 8)}` }
}

export default async function CSPermitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: CsTab = pickActiveTab(sp, CS_TABS, 'overview')
  const drawer = pickString(sp.drawer)
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        permit: csPermits,
        site: orgUnits,
        issuer: tenantUsers,
        issuerAccount: user,
      })
      .from(csPermits)
      .leftJoin(orgUnits, eq(orgUnits.id, csPermits.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, csPermits.issuedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(csPermits.id, id))
      .limit(1)
    if (!row) return null
    const [readings, personnel, allPeople] = await Promise.all([
      tx
        .select()
        .from(csAtmosphericReadings)
        .where(eq(csAtmosphericReadings.permitId, id))
        .orderBy(desc(csAtmosphericReadings.recordedAt)),
      tx
        .select({ row: csPermitPersonnel, person: people })
        .from(csPermitPersonnel)
        .innerJoin(people, eq(people.id, csPermitPersonnel.personId))
        .where(eq(csPermitPersonnel.permitId, id))
        .orderBy(desc(csPermitPersonnel.createdAt)),
      tx
        .select()
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500),
    ])
    return { ...row, readings, personnel, allPeople }
  })
  if (!data) notFound()
  const { permit, site, issuerAccount, readings, personnel, allPeople } = data
  const outOfSpec = readings.find((r) => r.outOfSpec === 1)

  const currentlyInside = personnel.filter((p) => p.row.enteredAt && !p.row.exitedAt)
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'cs_permit', id, 50) : []

  const basePath = `/confined-space/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/confined-space', label: 'Back to permits' }}
          title={permit.title}
          subtitle={`${permit.reference} · issued ${new Date(permit.issuedAt).toLocaleString()}`}
          badge={
            <Badge
              variant={
                permit.status === 'active'
                  ? 'success'
                  : permit.status === 'expired'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {permit.status}
            </Badge>
          }
          actions={
            <>
              {permit.status === 'open' ? (
                <form action={activatePermit} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit">Activate</Button>
                </form>
              ) : permit.status === 'active' ? (
                <form action={closePermit} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Close permit
                  </Button>
                </form>
              ) : null}
            </>
          }
        />
      }
      alerts={
        <>
          {outOfSpec ? (
            <Alert variant="destructive">
              <AlertTriangle size={16} />
              <AlertTitle>Out-of-spec atmospheric reading detected</AlertTitle>
              <AlertDescription>
                Most recent out-of-spec reading was on{' '}
                {new Date(outOfSpec.recordedAt).toLocaleString()}. Review before allowing further
                entry.
              </AlertDescription>
            </Alert>
          ) : null}
          {currentlyInside.length > 0 ? (
            <Alert variant="warning">
              <AlertTitle>
                {currentlyInside.length} person{currentlyInside.length === 1 ? '' : 's'} currently
                inside
              </AlertTitle>
              <AlertDescription>
                {currentlyInside
                  .map((p) => `${p.person.firstName} ${p.person.lastName} (${p.row.role})`)
                  .join(', ')}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'readings', label: 'Atmospheric readings', count: readings.length },
            { key: 'personnel', label: 'Entrants & attendants', count: personnel.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <Section title="Permit details">
            <DetailGrid
              rows={[
                {
                  label: 'Reference',
                  value: <span className="font-mono">{permit.reference}</span>,
                },
                { label: 'Site', value: site?.name ?? '—' },
                { label: 'Issued by', value: issuerAccount?.name ?? '—' },
                { label: 'Issued at', value: new Date(permit.issuedAt).toLocaleString() },
                { label: 'Expires at', value: new Date(permit.expiresAt).toLocaleString() },
                {
                  label: 'Closed at',
                  value: permit.closedAt ? new Date(permit.closedAt).toLocaleString() : '—',
                },
              ]}
            />
            <div className="mt-4 space-y-2 text-sm">
              <TextBlock label="Space description">{permit.spaceDescription}</TextBlock>
              <TextBlock label="Hazards identified">
                {permit.hazardIdentification.length > 0 ? (
                  <ul className="list-disc pl-5">
                    {permit.hazardIdentification.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </TextBlock>
              <TextBlock label="Rescue plan">
                {permit.rescuePlan ?? <span className="text-slate-500">—</span>}
              </TextBlock>
            </div>
          </Section>
        ) : null}

        {active === 'readings' ? (
          <Section title={`Atmospheric readings (${readings.length})`}>
            {readings.length === 0 ? (
              <EmptyState
                icon={<Wind size={24} />}
                title="No readings recorded yet"
                description="Log the first atmospheric reading below. Industry-standard pass thresholds: 19.5–23% O₂, LEL <10%, H₂S <10 ppm, CO <25 ppm."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>O₂ %</TableHead>
                    <TableHead>LEL %</TableHead>
                    <TableHead>H₂S ppm</TableHead>
                    <TableHead>CO ppm</TableHead>
                    <TableHead>Sensor</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readings.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.recordedAt).toLocaleString()}</TableCell>
                      <TableCell>{r.oxygenPct ?? '—'}</TableCell>
                      <TableCell>{r.lelPct ?? '—'}</TableCell>
                      <TableCell>{r.h2sPpm ?? '—'}</TableCell>
                      <TableCell>{r.coPpm ?? '—'}</TableCell>
                      <TableCell className="text-slate-600">{r.sensorIdentifier ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.outOfSpec ? 'destructive' : 'success'}>
                          {r.outOfSpec ? 'Out of spec' : 'Pass'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4">
              <Link href={`/confined-space/${id}?tab=readings&drawer=add-reading`}>
                <Button>
                  <Activity size={14} /> Record reading
                </Button>
              </Link>
            </div>
          </Section>
        ) : null}

        {active === 'personnel' ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  Permit personnel ({personnel.length}) ·{' '}
                  <span className="text-sm font-normal text-slate-500">
                    {currentlyInside.length} inside now
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {personnel.length === 0 ? (
                  <EmptyState
                    icon={<UserPlus size={24} />}
                    title="No personnel assigned to this permit"
                    description="Add entrants, attendants, supervisors, and rescue contacts below."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Entered</TableHead>
                        <TableHead>Exited</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {personnel.map((row) => (
                        <TableRow key={row.row.id}>
                          <TableCell>
                            <Link
                              href={`/people/${row.person.id}`}
                              className="font-medium hover:underline"
                            >
                              {row.person.firstName} {row.person.lastName}
                            </Link>
                            {row.person.jobTitle ? (
                              <div className="text-xs text-slate-500">{row.person.jobTitle}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{row.row.role}</Badge>
                          </TableCell>
                          <TableCell>
                            {row.row.enteredAt ? new Date(row.row.enteredAt).toLocaleString() : '—'}
                          </TableCell>
                          <TableCell>
                            {row.row.exitedAt ? (
                              new Date(row.row.exitedAt).toLocaleString()
                            ) : row.row.enteredAt ? (
                              <Badge variant="warning">Inside</Badge>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.row.note ?? '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {!row.row.enteredAt ? (
                              <form action={markEntered} className="inline">
                                <input type="hidden" name="id" value={row.row.id} />
                                <input type="hidden" name="permitId" value={id} />
                                <Button type="submit" size="sm" variant="outline">
                                  Mark entered
                                </Button>
                              </form>
                            ) : !row.row.exitedAt ? (
                              <form action={markExited} className="inline">
                                <input type="hidden" name="id" value={row.row.id} />
                                <input type="hidden" name="permitId" value={id} />
                                <Button type="submit" size="sm" variant="outline">
                                  <LogOut size={12} /> Mark exited
                                </Button>
                              </form>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <div>
              <Link href={`/confined-space/${id}?tab=personnel&drawer=add-personnel`}>
                <Button>
                  <UserPlus size={14} /> Add personnel
                </Button>
              </Link>
            </div>
          </div>
        ) : null}

        {active === 'activity' ? (
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <UrlDrawer
        open={drawer === 'add-reading'}
        closeHref={`/confined-space/${id}?tab=readings`}
        title="Record atmospheric reading"
        description="Industry-standard pass thresholds: 19.5–23% O₂, LEL <10%, H₂S <10 ppm, CO <25 ppm."
        size="md"
        footer={
          <>
            <Link href={`/confined-space/${id}?tab=readings`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="cs-add-reading-form">
              <Activity size={14} /> Record reading
            </Button>
          </>
        }
      >
        <form
          id="cs-add-reading-form"
          action={addReading}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <input type="hidden" name="permitId" value={id} />
          <Field label="O₂ %">
            <Input name="oxygenPct" type="number" step="0.1" placeholder="20.9" />
          </Field>
          <Field label="LEL %">
            <Input name="lelPct" type="number" step="0.1" placeholder="0" />
          </Field>
          <Field label="H₂S ppm">
            <Input name="h2sPpm" type="number" step="0.1" placeholder="0" />
          </Field>
          <Field label="CO ppm">
            <Input name="coPpm" type="number" step="0.1" placeholder="0" />
          </Field>
          <Field label="Sensor ID" className="sm:col-span-2">
            <Input name="sensorIdentifier" placeholder="e.g. GASMON-04" />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input name="note" placeholder="Optional" />
          </Field>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'add-personnel'}
        closeHref={`/confined-space/${id}?tab=personnel`}
        title="Add personnel"
        description="Assign an entrant, attendant, supervisor, or rescue contact to the permit."
        size="md"
        footer={
          <>
            <Link href={`/confined-space/${id}?tab=personnel`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="cs-add-personnel-form">
              <UserPlus size={14} /> Add to permit
            </Button>
          </>
        }
      >
        <form
          id="cs-add-personnel-form"
          action={addPersonnel}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="permitId" value={id} />
          <Field label="Person" required>
            <Select name="personId" required defaultValue="">
              <option value="">— Select —</option>
              {allPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName}
                  {p.employeeNo ? ` (#${p.employeeNo})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" required>
            <Select name="role" required defaultValue="entrant">
              <option value="entrant">Entrant</option>
              <option value="attendant">Attendant</option>
              <option value="supervisor">Supervisor</option>
              <option value="rescue">Rescue</option>
            </Select>
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input name="note" placeholder="Optional — e.g. shift label, contact number" />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <input
              id="cs-mark-entered"
              type="checkbox"
              name="markEntered"
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <Label htmlFor="cs-mark-entered" className="text-sm">
              Mark as entered now
            </Label>
          </div>
        </form>
      </UrlDrawer>
    </DetailPageLayout>
  )
}

function TextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-slate-900">{children}</div>
    </div>
  )
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
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label className="text-xs">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
