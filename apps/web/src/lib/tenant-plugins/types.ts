import type { RequestContext } from '@beaconhs/tenant'
import type * as schema from '@beaconhs/db/schema'
import type * as orm from 'drizzle-orm'
import type * as egress from '@beaconhs/sync/egress'
import type { unsealSecret } from '@beaconhs/crypto'
import type { recordAuditInTransaction } from '@/lib/audit'

/** Trusted, operator-installed server modules. Not a sandbox for tenant-authored code. */
export type TenantPluginSdk = {
  schema: typeof schema
  orm: typeof orm
  egress: typeof egress & { unsealSecret: typeof unsealSecret }
  recordAuditInTransaction: typeof recordAuditInTransaction
}
export type PluginActionContext = {
  ctx: RequestContext
  surface: string
  target: Readonly<Record<string, string>>
}
type PluginAction = {
  id: string
  label: string
  description?: string
  disabledReason?: string
  confirm?: string
  fields?: {
    name: string
    label: string
    value?: string
    options: { value: string; label: string }[]
  }[]
}
export type InstalledPluginAction = PluginAction & { pluginId: string }
export type PluginActionResult = { ok: true; message: string } | { ok: false; error: string }
export type TenantPlugin = {
  apiVersion: 1
  id: string
  actions(context: PluginActionContext): Promise<PluginAction[]>
  execute(
    context: PluginActionContext,
    actionId: string,
    fields: Record<string, string>,
  ): Promise<{ message: string }>
}
