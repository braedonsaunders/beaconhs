'use client'

// "Add to tenant" — the cross-tenant membership creator. Roles are per-tenant,
// so this is inherently two-step: pick a tenant, then pick from THAT tenant's
// roles. We preload every eligible tenant's roles (`rolesByTenant`) and switch
// the role list in the client rather than round-tripping, then submit to the
// `addMembership` server action. `mode` chooses invite (magic link) vs. add-now.

import * as React from 'react'
import { Button, Label, Select, cn } from '@beaconhs/ui'
import { addMembership } from '../_actions'

type TenantOpt = { id: string; name: string }
type RoleOpt = { id: string; name: string }

export function AddMembershipForm({
  userId,
  tenants,
  rolesByTenant,
}: {
  userId: string
  tenants: TenantOpt[]
  rolesByTenant: Record<string, RoleOpt[]>
}) {
  const [tenantId, setTenantId] = React.useState('')
  const [roleId, setRoleId] = React.useState('')
  const roleOptions = tenantId ? (rolesByTenant[tenantId] ?? []) : []

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        This user already belongs to every tenant.
      </p>
    )
  }

  return (
    <form action={addMembership} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="add-tenant">Tenant</Label>
          <Select
            id="add-tenant"
            name="tenantId"
            required
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.currentTarget.value)
              setRoleId('') // a role from the previous tenant no longer applies
            }}
          >
            <option value="" disabled>
              Select a tenant…
            </option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-role">Initial role</Label>
          <Select
            id="add-role"
            name="roleId"
            placeholder="No role"
            disabled={!tenantId}
            value={roleId}
            onChange={(e) => setRoleId(e.currentTarget.value)}
          >
            <option value="">No role</option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A starting role. Fine-tune scope and permissions from the tenant&apos;s Users page.
          </p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
          How to add them
        </legend>
        {(
          [
            {
              value: 'invite',
              title: 'Send an invite',
              desc: 'Emails a magic link. Membership starts as “invited” until they sign in.',
              defaultChecked: true,
            },
            {
              value: 'active',
              title: 'Add as active now',
              desc: 'No email. Use for provisioning — they get access immediately.',
              defaultChecked: false,
            },
          ] as const
        ).map((opt) => (
          <label
            key={opt.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3',
              'hover:border-amber-300 dark:border-slate-800 dark:hover:border-amber-800/60',
            )}
          >
            <input
              type="radio"
              name="mode"
              value={opt.value}
              defaultChecked={opt.defaultChecked}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                {opt.title}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.desc}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit">Add to tenant</Button>
      </div>
    </form>
  )
}
