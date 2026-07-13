'use client'

// Editable members list for the role detail page. Lists everyone who holds the
// role with their data scope, lets an admin re-scope or remove each member, and
// adds new members (multi-select over ACTIVE memberships) with a chosen scope.
// Posts to the role-scoped membership actions; self and protected super-admins
// are surfaced read-only, matching the server-side eligibility guards.
//
// The whole component is remounted by the parent on every membership change
// (keyed on the assignment signature), so transient UI state — the open add
// panel, candidate selection, the row being edited — resets cleanly after each
// save without fighting React's post-action form reset.

import { useMemo, useState, type FormEvent } from 'react'
import { Plus, UserPlus, X } from 'lucide-react'
import { Badge, Button, Label, SearchSelect } from '@beaconhs/ui'
import type { RoleScope } from '@beaconhs/db/schema'
import { ScopePicker } from '../../users/_components/scope-picker'
import type { ScopeOptions } from '../../users/_scope-data'
import { addRoleMembers, removeRoleMember, updateRoleMemberScope } from '../_actions'

export type RoleMember = {
  assignmentId: string
  name: string
  email: string
  displayName: string | null
  scope: RoleScope
  scopeLabel: string
  isSelf: boolean
  isProtectedSuperAdmin: boolean
}

type Candidate = { value: string; label: string; hint?: string }

export function RoleMembersManager({
  roleId,
  members,
  candidates,
  scopeOptions,
}: {
  roleId: string
  members: RoleMember[]
  candidates: Candidate[]
  scopeOptions: ScopeOptions
}) {
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const candidateById = useMemo(() => new Map(candidates.map((c) => [c.value, c])), [candidates])
  const available = useMemo(
    () => candidates.filter((c) => !picked.includes(c.value)),
    [candidates, picked],
  )
  const pickedCandidates = picked
    .map((id) => candidateById.get(id))
    .filter((c): c is Candidate => Boolean(c))

  function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    if (picked.length === 0) event.preventDefault()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {members.length === 0
            ? 'No members hold this role yet.'
            : `${members.length} member${members.length === 1 ? '' : 's'} hold this role.`}
        </p>
        {!adding ? (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus size={14} className="mr-1.5" />
            Add members
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form
          action={addRoleMembers}
          onSubmit={handleAddSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <input type="hidden" name="roleId" value={roleId} />
          {pickedCandidates.map((c) => (
            <input key={c.value} type="hidden" name="membershipIds" value={c.value} />
          ))}

          <div className="space-y-2">
            <Label>Members to add</Label>
            <SearchSelect
              value=""
              onChange={(v) => v && setPicked((prev) => [...prev, v])}
              options={available}
              placeholder={
                candidates.length === 0 ? 'Everyone already holds this role' : 'Add a member…'
              }
              searchPlaceholder="Search members…"
              sheetTitle="Select members"
              disabled={available.length === 0}
            />
            {pickedCandidates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pickedCandidates.map((c) => (
                  <span
                    key={c.value}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  >
                    {c.label}
                    <button
                      type="button"
                      aria-label={`Remove ${c.label}`}
                      onClick={() => setPicked((prev) => prev.filter((id) => id !== c.value))}
                      className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">No members selected yet.</p>
            )}
          </div>

          <ScopePicker
            sites={scopeOptions.sites}
            crews={scopeOptions.crews}
            departments={scopeOptions.departments}
            groups={scopeOptions.groups}
            people={scopeOptions.people}
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setPicked([])
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={picked.length === 0}>
              <Plus size={14} className="mr-1.5" />
              Add {picked.length || ''} member{picked.length === 1 ? '' : 's'}
            </Button>
          </div>
        </form>
      ) : null}

      {members.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {members.map((m) => {
            const locked = m.isSelf || m.isProtectedSuperAdmin
            const editing = editingId === m.assignmentId
            return (
              <li key={m.assignmentId} className="px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {m.displayName ?? m.name}
                      </span>
                      {m.isSelf ? (
                        <Badge variant="outline" className="text-[10px]">
                          You
                        </Badge>
                      ) : null}
                      {m.isProtectedSuperAdmin ? (
                        <Badge variant="warning" className="text-[10px]">
                          Super-admin
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {m.email}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {m.scopeLabel}
                    </div>
                  </div>
                  {!locked ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(editing ? null : m.assignmentId)}
                      >
                        {editing ? 'Close' : 'Edit scope'}
                      </Button>
                      <form action={removeRoleMember}>
                        <input type="hidden" name="roleId" value={roleId} />
                        <input type="hidden" name="assignmentId" value={m.assignmentId} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400"
                        >
                          Remove
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                      Managed elsewhere
                    </span>
                  )}
                </div>

                {editing ? (
                  <form
                    action={updateRoleMemberScope}
                    className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <input type="hidden" name="roleId" value={roleId} />
                    <input type="hidden" name="assignmentId" value={m.assignmentId} />
                    <ScopePicker
                      defaultScope={m.scope}
                      sites={scopeOptions.sites}
                      crews={scopeOptions.crews}
                      departments={scopeOptions.departments}
                      groups={scopeOptions.groups}
                      people={scopeOptions.people}
                    />
                    <div className="flex justify-end">
                      <Button type="submit" size="sm">
                        Save scope
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
