import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { Activity, AlertTriangle, Wind } from 'lucide-react'
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
  csAtmosphericReadings,
  csPermits,
  orgUnits,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const CS_TABS = ['overview', 'readings'] as const
type CsTab = (typeof CS_TABS)[number]

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

  // Industry-standard pass thresholds: 19.5%–23% O2; LEL <10%; H2S <10ppm; CO <25ppm
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
}

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
    const readings = await tx
      .select()
      .from(csAtmosphericReadings)
      .where(eq(csAtmosphericReadings.permitId, id))
      .orderBy(desc(csAtmosphericReadings.recordedAt))
    return { ...row, readings }
  })
  if (!data) notFound()
  const { permit, site, issuerAccount, readings } = data
  const outOfSpec = readings.find((r) => r.outOfSpec === 1)

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
                  <Button type="submit" variant="outline">Close permit</Button>
                </form>
              ) : null}
            </>
          }
        />
      }
      alerts={
        outOfSpec ? (
          <Alert variant="destructive">
            <AlertTriangle size={16} />
            <AlertTitle>Out-of-spec atmospheric reading detected</AlertTitle>
            <AlertDescription>
              Most recent out-of-spec reading was on{' '}
              {new Date(outOfSpec.recordedAt).toLocaleString()}. Review before allowing further entry.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'readings', label: 'Atmospheric readings', count: readings.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
        <Section title="Permit details">
          <DetailGrid
            rows={[
              { label: 'Reference', value: <span className="font-mono">{permit.reference}</span> },
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
            <p className="text-sm text-slate-500">No readings recorded yet.</p>
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

          <Card className="mt-4 border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wind size={14} /> Record a new reading
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={addReading} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                <div className="sm:col-span-4">
                  <Button type="submit">
                    <Activity size={14} /> Record reading
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </Section>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function TextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-slate-900">{children}</div>
    </div>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
