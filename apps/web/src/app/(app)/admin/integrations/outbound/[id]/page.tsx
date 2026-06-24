// /admin/integrations/outbound/[id] — configure one outbound-integration
// instance (a tenant_integrations row): enable it, set its config + sealed
// secrets, test connectivity, or remove it. Gated by admin.integrations.manage.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { ArrowLeft, Send, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
  cn,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { tenantIntegrations } from '@beaconhs/db/schema'
import type { ConfigField } from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { getOutboundIntegration } from '@/lib/integrations'
import { PageContainer } from '@/components/page-layout'
import { deleteOutbound, saveOutbound, testOutbound } from '../_actions'

export const metadata = { title: 'Outbound integration' }
export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  draft: 'bg-slate-50 text-slate-600 ring-slate-200',
  disabled: 'bg-slate-50 text-slate-500 ring-slate-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
}

function FieldInput({ field, value }: { field: ConfigField; value: unknown }) {
  const v = value == null ? '' : String(value)
  return (
    <div className={cn('space-y-1.5', field.type === 'textarea' && 'sm:col-span-2')}>
      <Label htmlFor={field.key}>
        {field.label}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {field.type === 'textarea' ? (
        <Textarea
          id={field.key}
          name={field.key}
          rows={5}
          defaultValue={v}
          placeholder={field.placeholder}
          className="font-mono text-xs"
        />
      ) : field.type === 'select' ? (
        <Select id={field.key} name={field.key} defaultValue={v}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === 'boolean' ? (
        <div className="pt-1">
          <input
            type="checkbox"
            name={field.key}
            defaultChecked={value === true || value === 'true'}
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>
      ) : (
        <Input
          id={field.key}
          name={field.key}
          type={field.type === 'number' ? 'number' : 'text'}
          defaultValue={v}
          placeholder={field.placeholder}
        />
      )}
      {field.help ? <p className="text-xs text-slate-400">{field.help}</p> : null}
    </div>
  )
}

export default async function OutboundIntegrationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.id, id), isNull(tenantIntegrations.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()

  const def = getOutboundIntegration(row.integrationKey)
  const config = (row.config as Record<string, unknown>) ?? {}
  const secrets = (row.secrets as Record<string, unknown>) ?? {}
  const status = row.enabled ? row.status : 'disabled'

  return (
    <PageContainer>
      <div className="space-y-6">
        <Link
          href="/admin/integrations"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={14} /> Back to integrations
        </Link>

        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">
              {def?.name ?? row.integrationKey}
            </h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                STATUS_PILL[status] ?? STATUS_PILL.draft,
              )}
            >
              {status}
            </span>
          </div>
          {def ? <p className="max-w-2xl text-sm text-slate-500">{def.description}</p> : null}
          {row.lastError ? (
            <p className="text-xs text-red-600">Last error: {row.lastError}</p>
          ) : row.lastRunAt ? (
            <p className="text-xs text-slate-400">
              Last run {new Date(row.lastRunAt).toLocaleString()}
            </p>
          ) : null}
        </header>

        {!def ? (
          <Card>
            <CardContent className="py-6 text-sm text-slate-600">
              This integration is no longer available in this build. You can remove it below.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={saveOutbound} className="space-y-4">
                <input type="hidden" name="id" value={row.id} />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={row.enabled}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm font-medium text-slate-800">Enabled</span>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {def.configFields.map((f) => (
                    <FieldInput key={f.key} field={f} value={config[f.key]} />
                  ))}
                </div>
                {def.secretFields.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {def.secretFields.map((s) => (
                      <div key={s.key} className="space-y-1.5">
                        <Label htmlFor={s.key}>
                          {s.label}
                          {s.required ? <span className="text-red-600"> *</span> : null}
                        </Label>
                        <Input
                          id={s.key}
                          name={s.key}
                          type="password"
                          autoComplete="new-password"
                          placeholder={secrets[s.key] ? '•••••••• (unchanged)' : ''}
                        />
                        {s.help ? <p className="text-xs text-slate-400">{s.help}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit">Save</Button>
                </div>
              </form>

              {def.test ? (
                <form
                  action={testOutbound}
                  className="flex justify-end border-t border-slate-100 pt-3"
                >
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="outline" size="sm">
                    <Send size={14} /> Test connection
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        )}

        <form action={deleteOutbound}>
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 size={14} /> Remove integration
          </Button>
        </form>
      </div>
    </PageContainer>
  )
}
