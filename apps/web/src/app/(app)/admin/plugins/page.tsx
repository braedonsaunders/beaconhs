import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { Plug } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
} from '@beaconhs/ui'
import { db } from '@beaconhs/db'
import { plugins, tenantPlugins } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Plugins' }
export const dynamic = 'force-dynamic'

async function togglePlugin(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const pluginId = String(formData.get('pluginId') ?? '')
  const enable = formData.get('enable') === 'true'
  const installed = await ctx.db((tx) =>
    tx.select().from(tenantPlugins).where(eq(tenantPlugins.pluginId, pluginId)).limit(1),
  )
  if (installed[0]) {
    await ctx.db((tx) =>
      tx
        .update(tenantPlugins)
        .set({ enabled: enable })
        .where(eq(tenantPlugins.id, installed[0]!.id)),
    )
  } else if (enable) {
    await ctx.db((tx) =>
      tx.insert(tenantPlugins).values({
        tenantId: ctx.tenantId,
        pluginId,
        enabled: true,
        config: {},
      }),
    )
  }
  await recordAudit(ctx, {
    entityType: 'tenant_plugin',
    entityId: pluginId,
    action: 'update',
    summary: enable ? 'Plugin enabled' : 'Plugin disabled',
  })
  revalidatePath('/admin/plugins')
}

export default async function AdminPluginsPage() {
  const ctx = await requireRequestContext()
  // Catalogue lives in `plugins` (cross-tenant). Read with bypass.
  const catalogue = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    return tx.select().from(plugins).orderBy(plugins.name)
  })
  const installed = await ctx.db((tx) => tx.select().from(tenantPlugins))
  const installedMap = new Map(installed.map((i) => [i.pluginId, i]))

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Plugins"
          subtitle="First-party integrations. Tenants toggle them on/off and configure secrets per-tenant."
        />

        {catalogue.length === 0 ? (
          <EmptyState
            icon={<Plug size={32} />}
            title="No plugins published yet"
            description="Enable + configure first-party integrations: NetSuite sync, adminapp2-sync, webhook-out. The plugin SDK runtime is still under development — enabled plugins record state today but execution is gated until that ships."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {catalogue.map((p) => {
              const status = installedMap.get(p.id)
              const enabled = status?.enabled === true
              return (
                <Card key={p.id} className={enabled ? 'border-teal-300' : ''}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{p.name}</CardTitle>
                        <CardDescription>{p.description ?? '—'}</CardDescription>
                      </div>
                      <Badge variant={enabled ? 'success' : 'secondary'}>
                        {enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {p.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>v{p.version}</span>
                      <form action={togglePlugin} className="inline">
                        <input type="hidden" name="pluginId" value={p.id} />
                        <input type="hidden" name="enable" value={enabled ? 'false' : 'true'} />
                        <Button type="submit" size="sm" variant={enabled ? 'outline' : 'default'}>
                          {enabled ? 'Disable' : 'Enable'}
                        </Button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
