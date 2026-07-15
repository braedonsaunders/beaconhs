'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
  const [tenantId, setTenantId] = React.useState('')
  const [roleId, setRoleId] = React.useState('')
  const roleOptions = tenantId ? (rolesByTenant[tenantId] ?? []) : []

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_1c1ac28febebb9" />
      </p>
    )
  }

  return (
    <form action={addMembership} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="add-tenant">
            <GeneratedText id="m_1fd4a056042e4d" />
          </Label>
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
              <GeneratedText id="m_1a53f4c5dcddc6" />
            </option>
            <GeneratedValue
              value={tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  <GeneratedValue value={t.name} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-role">
            <GeneratedText id="m_12e16ef485d96c" />
          </Label>
          <Select
            id="add-role"
            name="roleId"
            placeholder={tGenerated('m_0f222c2787326f')}
            disabled={!tenantId}
            value={roleId}
            onChange={(e) => setRoleId(e.currentTarget.value)}
          >
            <option value="">
              <GeneratedText id="m_0f222c2787326f" />
            </option>
            <GeneratedValue
              value={roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  <GeneratedValue value={r.name} />
                </option>
              ))}
            />
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_049ce663104999" />
          </p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_0ee2e3e43d72a8" />
        </legend>
        <GeneratedValue
          value={(
            [
              {
                value: 'invite',
                title: 'Send an invite',
                desc: 'Emails a one-time link. Membership stays “invited” until they accept it.',
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
                  <GeneratedValue value={opt.title} />
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={opt.desc} />
                </span>
              </span>
            </label>
          ))}
        />
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit">
          <GeneratedText id="m_11754a76369223" />
        </Button>
      </div>
    </form>
  )
}
