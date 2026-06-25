import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, count, eq, sql } from 'drizzle-orm'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { db } from '@beaconhs/db'
import { incidents, people, tenantUsers, tenants } from '@beaconhs/db/schema'
import { getCurrentUserId } from '@/lib/auth'
import { setActiveTenant } from '@/lib/actions'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'All tenants' }
export const dynamic = 'force-dynamic'

async function viewAs(formData: FormData) {
  'use server'
  const tenantId = String(formData.get('tenantId') ?? '')
  await setActiveTenant(tenantId)
  redirect('/dashboard')
}

export default async function AdminTenantsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    return tx
      .select({
        tenant: tenants,
        memberCount: sql<number>`(select count(*) from ${tenantUsers} where ${tenantUsers.tenantId} = ${tenants.id})`,
        peopleCount: sql<number>`(select count(*) from ${people} where ${people.tenantId} = ${tenants.id})`,
        incidentCount: sql<number>`(select count(*) from ${incidents} where ${incidents.tenantId} = ${tenants.id})`,
      })
      .from(tenants)
      .orderBy(asc(tenants.name))
  })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title="All tenants"
          subtitle="Super-admin view of every tenant on this deployment"
          actions={
            <div className="flex items-center gap-2">
              <Link href="/platform/tenants/seed-templates">
                <Button variant="outline">Seed built-in templates</Button>
              </Link>
              <Link href="/platform/tenants/new">
                <Button>New tenant</Button>
              </Link>
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState title="No tenants" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Incidents</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ tenant, memberCount, peopleCount, incidentCount }) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">{tenant.name}</TableCell>
                  <TableCell className="font-mono text-xs">{tenant.slug}</TableCell>
                  <TableCell>
                    <Badge variant={tenant.status === 'active' ? 'success' : 'secondary'}>
                      {tenant.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.region}</TableCell>
                  <TableCell>{Number(memberCount)}</TableCell>
                  <TableCell>{Number(peopleCount)}</TableCell>
                  <TableCell>{Number(incidentCount)}</TableCell>
                  <TableCell>
                    <form action={viewAs}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <Button type="submit" size="sm" variant="outline">
                        View as
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  )
}
