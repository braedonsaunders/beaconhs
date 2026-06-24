// /admin/integrations/outbound — event-driven outbound integrations. Unlike the
// inbound sync connections, these push data OUT to an external system when a
// domain event fires (e.g. the adminapp2 training-time export on class close).
// Each integration is disabled until configured + enabled here.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Send, Upload } from 'lucide-react'
import { isNull } from 'drizzle-orm'
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
import { PageContainer } from '@/components/page-layout'
import { listOutboundIntegrations } from '@/lib/integrations'
import { saveOutbound, testOutbound } from './_actions'

export const metadata = { title: 'Outbound integrations' }
export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  draft: 'bg-slate-50 text-slate-600 ring-slate-200',
  disabled: 'bg-slate-50 text-slate-500 ring-slate-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
}

function StatusPill({ status, enabled }: { status: string; enabled: boolean }) {
  const label = !enabled && status !== 'error' ? 'disabled' : status
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        STATUS_PILL[label] ?? STATUS_PILL.draft,
      )}
    >
      {label}
    </span>
  )
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

export default async function OutboundIntegrationsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const defs = listOutboundIntegrations()
  const rows = await ctx.db((tx) =>
    tx.select().from(tenantIntegrations).where(isNull(tenantIntegrations.deletedAt)),
  )
  const byKey = new Map(rows.map((r) => [r.integrationKey, r]))

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
          <div className="flex items-center gap-2">
            <Upload size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900">Outbound integrations</h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500">
            Push data to an external system when something happens here. Each integration is
            disabled until you configure it and turn it on. Credentials are encrypted at rest.
          </p>
        </header>

        <div className="space-y-5">
          {defs.map((def) => {
            const row = byKey.get(def.key)
            const config = (row?.config as Record<string, unknown>) ?? {}
            const secrets = (row?.secrets as Record<string, unknown>) ?? {}
            return (
              <Card key={def.key}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{def.name}</CardTitle>
                    <StatusPill status={row?.status ?? 'draft'} enabled={!!row?.enabled} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{def.description}</p>
                  {row?.lastError ? (
                    <p className="mt-1 text-xs text-red-600">Last error: {row.lastError}</p>
                  ) : row?.lastRunAt ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Last run {new Date(row.lastRunAt).toLocaleString()}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4">
                  <form action={saveOutbound} className="space-y-4">
                    <input type="hidden" name="integrationKey" value={def.key} />
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={!!row?.enabled}
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
                      <input type="hidden" name="integrationKey" value={def.key} />
                      <Button type="submit" variant="outline" size="sm">
                        <Send size={14} /> Test connection
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </PageContainer>
  )
}
