import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { Badge, Button, DetailHeader } from '@beaconhs/ui'
import { roleDashboardLayouts, roles, type DashboardLayoutData } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { DashboardGrid } from '@/app/(app)/dashboard/_dashboard-grid'
import { loadDashboardEditCanvas } from '@/app/(app)/dashboard/_edit-canvas'
import { DEFAULT_LAYOUTS } from '@/app/(app)/dashboard/_role-defaults'
import { inferRoleTier, ROLE_TIER_LABELS } from '@/app/(app)/dashboard/_role-tier'
import { WIDGETS } from '@/app/(app)/dashboard/_widget-registry'
import {
  canPermissionSetPublishInsights,
  canPermissionSetSeeWidget,
  canPermissionSetViewInsights,
} from '@/app/(app)/dashboard/_widget-access'
import { resetRoleDashboardLayout, saveRoleDashboardLayout } from '../../_actions'

export const metadata = { title: 'Role default dashboard' }
export const dynamic = 'force-dynamic'

export default async function RoleDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const { id } = await params

  const data = await ctx.db(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    if (!role) return null
    const [dashboard] = await tx
      .select({ layout: roleDashboardLayouts.layout })
      .from(roleDashboardLayouts)
      .where(eq(roleDashboardLayouts.roleId, id))
      .limit(1)
    return { role, layout: dashboard?.layout ?? null }
  })
  if (!data) notFound()

  const { role } = data
  const roleTier = inferRoleTier(role)
  const layout = data.layout ?? DEFAULT_LAYOUTS[roleTier] ?? DEFAULT_LAYOUTS.worker
  const roleCanViewInsights = canPermissionSetViewInsights(role.permissions)
  const roleCanSeeAllPublishedInsights = canPermissionSetPublishInsights(role.permissions)
  const { nodes, libraryCards } = await loadDashboardEditCanvas(ctx, layout, {
    includeLibraryCards: roleCanViewInsights,
    filterLibraryCard: (card) =>
      card.status === 'published' &&
      (roleCanSeeAllPublishedInsights ||
        !card.allowedRoles ||
        card.allowedRoles.length === 0 ||
        card.allowedRoles.includes(role.key)),
  })
  const allowedWidgetIds = Object.keys(WIDGETS).filter((widgetId) =>
    canPermissionSetSeeWidget(role.permissions, widgetId),
  )

  async function saveLayout(input: { widgets: DashboardLayoutData['widgets'] }) {
    'use server'
    return saveRoleDashboardLayout({ roleId: id, widgets: input.widgets })
  }

  async function resetLayout() {
    'use server'
    return resetRoleDashboardLayout({ roleId: id })
  }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: `/admin/roles/${id}`, label: `Back to ${role.name}` }}
          title={`${role.name} default dashboard`}
          subtitle={`${ROLE_TIER_LABELS[roleTier]} starting layout for members who hold this role.`}
          badge={
            data.layout ? (
              <Badge variant="secondary">Configured</Badge>
            ) : (
              <Badge variant="outline">Shipped default</Badge>
            )
          }
          actions={
            <Link href={`/admin/roles/${id}` as any}>
              <Button variant="outline">
                <ArrowLeft size={14} className="mr-1.5" />
                Role details
              </Button>
            </Link>
          }
        />

        <DashboardGrid
          key={`${role.id}:${JSON.stringify(layout.widgets)}`}
          initialLayout={layout}
          nodes={nodes}
          role={roleTier}
          mode="edit"
          libraryCards={libraryCards}
          allowedWidgetIds={allowedWidgetIds}
          saveLayoutAction={saveLayout}
          resetLayoutAction={resetLayout}
          saveRedirectHref={`/admin/roles/${id}`}
          toolbarLabel={`Editing ${role.name} default`}
          resetConfirmMessage={`Reset ${role.name}'s default dashboard to the shipped ${ROLE_TIER_LABELS[roleTier]} layout?`}
          saveSuccessMessage="Role default dashboard saved"
          resetSuccessMessage="Role default dashboard reset"
        />
      </div>
    </PageContainer>
  )
}
