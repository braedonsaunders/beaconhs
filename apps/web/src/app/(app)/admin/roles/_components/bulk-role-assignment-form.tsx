'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Search, UsersRound } from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select, cn } from '@beaconhs/ui'
import { ScopePicker } from '../../users/_components/scope-picker'
import type { ScopeOptions } from '../../users/_scope-data'
import { bulkUpdateRoleAssignments } from '../_actions'

type RoleOption = {
  id: string
  name: string
  isBuiltIn: boolean
}

type MemberOption = {
  id: string
  name: string
  email: string
  displayName: string | null
  status: 'active' | 'invited' | 'suspended'
  roles: { id: string; name: string }[]
  isSelf: boolean
  isProtectedSuperAdmin: boolean
}

const OPERATIONS = [
  {
    value: 'add',
    label: 'Add or update',
    description: 'Keep existing roles and update the target role scope.',
  },
  {
    value: 'replace',
    label: 'Replace roles',
    description: 'Remove existing roles and assign only the target role.',
  },
  {
    value: 'remove',
    label: 'Remove role',
    description: 'Remove the target role from selected members.',
  },
] as const

const MAX_BULK_ROLE_MEMBERS = 250

function statusVariant(status: MemberOption['status']) {
  return status === 'active' ? 'success' : status === 'invited' ? 'secondary' : 'destructive'
}

export function BulkRoleAssignmentForm({
  roles,
  members,
  scopeOptions,
}: {
  roles: RoleOption[]
  members: MemberOption[]
  scopeOptions: ScopeOptions
}) {
  const [open, setOpen] = useState(false)
  const [operation, setOperation] = useState<(typeof OPERATIONS)[number]['value']>('add')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((member) => {
      const haystack = [
        member.displayName ?? '',
        member.name,
        member.email,
        member.status,
        ...member.roles.map((role) => role.name),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [members, query])

  const visibleAssignableIds = filtered
    .filter((member) => !member.isSelf && !member.isProtectedSuperAdmin)
    .map((member) => member.id)
  const visibleSelected = visibleAssignableIds.filter((id) => selected.has(id)).length
  const allVisibleSelected =
    visibleAssignableIds.length > 0 && visibleSelected === visibleAssignableIds.length

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleAssignableIds) next.delete(id)
      } else {
        for (const id of visibleAssignableIds) next.add(id)
      }
      return next
    })
  }

  const selectedMembers = [...selected]
    .map((id) => memberById.get(id))
    .filter((member): member is MemberOption => Boolean(member))
  const selectedRoleName = roles.find((role) => role.id === roleId)?.name ?? 'the selected role'
  const overLimit = selected.size > MAX_BULK_ROLE_MEMBERS

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (selected.size === 0 || overLimit) {
      event.preventDefault()
      return
    }
    if (operation === 'replace') {
      const ok = confirm(
        `Replace all roles for ${selected.size} selected member${
          selected.size === 1 ? '' : 's'
        } with "${selectedRoleName}"?`,
      )
      if (!ok) event.preventDefault()
    }
    if (operation === 'remove') {
      const ok = confirm(
        `Remove "${selectedRoleName}" from ${selected.size} selected member${
          selected.size === 1 ? '' : 's'
        }?`,
      )
      if (!ok) event.preventDefault()
    }
  }

  const footer = (
    <>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button
        type="submit"
        form="bulk-role-assignment-form"
        disabled={selected.size === 0 || overLimit || !roleId}
      >
        <UsersRound size={14} className="mr-1.5" />
        Apply to {selected.size} member{selected.size === 1 ? '' : 's'}
      </Button>
    </>
  )

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UsersRound size={14} className="mr-1.5" />
        Bulk roles
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Bulk role manager"
        description="Assign or change roles for multiple members."
        size="2xl"
        footer={footer}
      >
        <form
          id="bulk-role-assignment-form"
          action={bulkUpdateRoleAssignments}
          className="space-y-5"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="operation" value={operation} />
          {selectedMembers.map((member) => (
            <input key={member.id} type="hidden" name="membershipIds" value={member.id} />
          ))}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-role-id">Target role</Label>
                <Select
                  id="bulk-role-id"
                  name="roleId"
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                  required
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Operation</Label>
                <div className="grid gap-2">
                  {OPERATIONS.map((op) => {
                    const active = operation === op.value
                    return (
                      <label
                        key={op.value}
                        className={cn(
                          'flex cursor-pointer gap-3 rounded-lg border px-3 py-2 transition-colors',
                          active
                            ? 'border-teal-500 bg-teal-50 text-teal-950 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-100'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
                        )}
                      >
                        <input
                          type="radio"
                          className="mt-1 h-4 w-4 border-slate-300 text-teal-600 focus:ring-teal-500/40"
                          checked={active}
                          onChange={() => setOperation(op.value)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{op.label}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {op.description}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {operation !== 'remove' ? (
                <ScopePicker
                  sites={scopeOptions.sites}
                  crews={scopeOptions.crews}
                  departments={scopeOptions.departments}
                  groups={scopeOptions.groups}
                  people={scopeOptions.people}
                />
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="bulk-member-search">Members</Label>
                  <div className="relative">
                    <Search
                      size={14}
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      id="bulk-member-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search members or roles..."
                      className="pl-8"
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={toggleVisible}>
                  {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <span>
                    {selected.size} selected · {filtered.length} shown · {MAX_BULK_ROLE_MEMBERS} max
                  </span>
                  <span>{visibleAssignableIds.length} available</span>
                </div>
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                      No members match.
                    </div>
                  ) : (
                    filtered.map((member) => {
                      const disabled = member.isSelf || member.isProtectedSuperAdmin
                      return (
                        <label
                          key={member.id}
                          className={cn(
                            'flex gap-3 px-3 py-2.5 transition-colors',
                            disabled
                              ? 'cursor-not-allowed opacity-60'
                              : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(member.id)}
                            disabled={disabled}
                            onChange={(event) => toggle(member.id, event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500/40 dark:border-slate-600 dark:bg-slate-800"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                {member.displayName ?? member.name}
                              </span>
                              <Badge variant={statusVariant(member.status)} className="text-[10px]">
                                {member.status}
                              </Badge>
                              {member.isSelf ? (
                                <Badge variant="outline" className="text-[10px]">
                                  You
                                </Badge>
                              ) : null}
                              {member.isProtectedSuperAdmin ? (
                                <Badge variant="warning" className="text-[10px]">
                                  Super-admin
                                </Badge>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                              {member.email}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {member.roles.length === 0 ? (
                                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                  No roles
                                </span>
                              ) : (
                                member.roles.map((role) => (
                                  <span
                                    key={role.id}
                                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                  >
                                    {role.name}
                                  </span>
                                ))
                              )}
                            </span>
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {overLimit ? (
                <p className="text-right text-xs text-red-600 dark:text-red-300">
                  Select {MAX_BULK_ROLE_MEMBERS} or fewer members at a time.
                </p>
              ) : null}
            </div>
          </div>
        </form>
      </Drawer>
    </>
  )
}
