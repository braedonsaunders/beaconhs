'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Search, UsersRound } from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select, cn } from '@beaconhs/ui'
import { ScopePicker } from '../../users/_components/scope-picker'
import type { ScopeOptions } from '../../users/_scope-data'
import { bulkUpdateRoleAssignments } from '../_actions'
import { confirmDialog } from '@/lib/confirm'

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

export function BulkRoleAssignmentForm({
  roles,
  members,
  scopeOptions,
}: {
  roles: RoleOption[]
  members: MemberOption[]
  scopeOptions: ScopeOptions
}) {
  const tGenerated = useGeneratedTranslations()
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

  const confirmedRef = useRef(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (selected.size === 0 || overLimit) {
      event.preventDefault()
      return
    }
    // A resubmit fired after the confirm dialog resolved — let it through.
    if (confirmedRef.current) {
      confirmedRef.current = false
      return
    }
    const message =
      operation === 'replace'
        ? `Replace all roles for ${selected.size} selected member${
            selected.size === 1 ? '' : 's'
          } with "${selectedRoleName}"?`
        : operation === 'remove'
          ? `Remove "${selectedRoleName}" from ${selected.size} selected member${
              selected.size === 1 ? '' : 's'
            }?`
          : null
    if (!message) return
    event.preventDefault()
    const form = event.currentTarget
    void confirmDialog(message).then((ok) => {
      if (ok) {
        confirmedRef.current = true
        form.requestSubmit()
      }
    })
  }

  const footer = (
    <>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        <GeneratedText id="m_112e2e8ecda428" />
      </Button>
      <Button
        type="submit"
        form="bulk-role-assignment-form"
        disabled={selected.size === 0 || overLimit || !roleId}
      >
        <UsersRound size={14} className="mr-1.5" />
        <GeneratedText id="m_0ae81d5803ad12" /> <GeneratedValue value={selected.size} />{' '}
        <GeneratedText id="m_1eccfcf56d888c" />
        <GeneratedValue
          value={selected.size === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
        />
      </Button>
    </>
  )

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UsersRound size={14} className="mr-1.5" />
        <GeneratedText id="m_07cee6f64f983c" />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_0c075a43e5da02')}
        description={tGenerated('m_1ffff35ea25e46')}
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
          <GeneratedValue
            value={selectedMembers.map((member) => (
              <input key={member.id} type="hidden" name="membershipIds" value={member.id} />
            ))}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-role-id">
                  <GeneratedText id="m_16bbffe5aee29c" />
                </Label>
                <Select
                  id="bulk-role-id"
                  name="roleId"
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                  required
                >
                  <GeneratedValue
                    value={roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        <GeneratedValue value={role.name} />
                      </option>
                    ))}
                  />
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  <GeneratedText id="m_10e4142fdf67e9" />
                </Label>
                <div className="grid gap-2">
                  <GeneratedValue
                    value={OPERATIONS.map((op) => {
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
                            <span className="block text-sm font-medium">
                              <GeneratedValue value={op.label} />
                            </span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedValue value={op.description} />
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  />
                </div>
              </div>

              <GeneratedValue
                value={
                  operation !== 'remove' ? (
                    <ScopePicker
                      sites={scopeOptions.sites}
                      crews={scopeOptions.crews}
                      departments={scopeOptions.departments}
                      groups={scopeOptions.groups}
                      people={scopeOptions.people}
                    />
                  ) : null
                }
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="bulk-member-search">
                    <GeneratedText id="m_0ef3898622f868" />
                  </Label>
                  <div className="relative">
                    <Search
                      size={14}
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      id="bulk-member-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={tGenerated('m_128657fa482122')}
                      className="pl-8"
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={toggleVisible}>
                  <GeneratedValue
                    value={
                      allVisibleSelected ? (
                        <GeneratedText id="m_1807ae9070f4d8" />
                      ) : (
                        <GeneratedText id="m_186bc2ea369bf1" />
                      )
                    }
                  />
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <span>
                    <GeneratedValue value={selected.size} /> <GeneratedText id="m_1d1098e0788108" />{' '}
                    <GeneratedValue value={filtered.length} />{' '}
                    <GeneratedText id="m_08d63ce9e265ef" />{' '}
                    <GeneratedValue value={MAX_BULK_ROLE_MEMBERS} />{' '}
                    <GeneratedText id="m_068795ae127fa2" />
                  </span>
                  <span>
                    <GeneratedValue value={visibleAssignableIds.length} />{' '}
                    <GeneratedText id="m_1e07a9a0372d84" />
                  </span>
                </div>
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  <GeneratedValue
                    value={
                      filtered.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_0444cfe7822ca3" />
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
                                    <GeneratedValue value={member.displayName ?? member.name} />
                                  </span>
                                  <GeneratedValue
                                    value={
                                      member.isSelf ? (
                                        <Badge variant="outline" className="text-[10px]">
                                          <GeneratedText id="m_1f107a64fd97ca" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                  <GeneratedValue
                                    value={
                                      member.isProtectedSuperAdmin ? (
                                        <Badge variant="warning" className="text-[10px]">
                                          <GeneratedText id="m_1db87d487dfb0a" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </span>
                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue value={member.email} />
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1">
                                  <GeneratedValue
                                    value={
                                      member.roles.length === 0 ? (
                                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                          <GeneratedText id="m_0f1763e8701d84" />
                                        </span>
                                      ) : (
                                        member.roles.map((role) => (
                                          <span
                                            key={role.id}
                                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                          >
                                            <GeneratedValue value={role.name} />
                                          </span>
                                        ))
                                      )
                                    }
                                  />
                                </span>
                              </span>
                            </label>
                          )
                        })
                      )
                    }
                  />
                </div>
              </div>

              <GeneratedValue
                value={
                  overLimit ? (
                    <p className="text-right text-xs text-red-600 dark:text-red-300">
                      <GeneratedText id="m_0219d74b52e206" />{' '}
                      <GeneratedValue value={MAX_BULK_ROLE_MEMBERS} />{' '}
                      <GeneratedText id="m_0fa49cf07d23e4" />
                    </p>
                  ) : null
                }
              />
            </div>
          </div>
        </form>
      </Drawer>
    </>
  )
}
