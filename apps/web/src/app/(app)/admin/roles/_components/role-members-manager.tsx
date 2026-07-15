'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
          <GeneratedValue
            value={
              members.length === 0 ? (
                <GeneratedText id="m_00c40b713d7073" />
              ) : (
                <GeneratedText
                  id="m_0e027042699f4d"
                  values={{ value0: members.length, value1: members.length === 1 ? '' : 's' }}
                />
              )
            }
          />
        </p>
        <GeneratedValue
          value={
            !adding ? (
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <UserPlus size={14} className="mr-1.5" />
                <GeneratedText id="m_1971b97be8f90f" />
              </Button>
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          adding ? (
            <form
              action={addRoleMembers}
              onSubmit={handleAddSubmit}
              className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <input type="hidden" name="roleId" value={roleId} />
              <GeneratedValue
                value={pickedCandidates.map((c) => (
                  <input key={c.value} type="hidden" name="membershipIds" value={c.value} />
                ))}
              />

              <div className="space-y-2">
                <Label>
                  <GeneratedText id="m_1e5cb2d07e8448" />
                </Label>
                <SearchSelect
                  value=""
                  onChange={(v) => v && setPicked((prev) => [...prev, v])}
                  options={available}
                  placeholder={tGeneratedValue(
                    candidates.length === 0
                      ? tGenerated('m_04b098c892a663')
                      : tGenerated('m_1792ef096e2128'),
                  )}
                  searchPlaceholder={tGenerated('m_0f2fe29f21ee57')}
                  sheetTitle="Select members"
                  disabled={available.length === 0}
                />
                <GeneratedValue
                  value={
                    pickedCandidates.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        <GeneratedValue
                          value={pickedCandidates.map((c) => (
                            <span
                              key={c.value}
                              className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                            >
                              <GeneratedValue value={c.label} />
                              <button
                                type="button"
                                aria-label={tGenerated('m_101f98a70352fa', { value0: c.label })}
                                onClick={() =>
                                  setPicked((prev) => prev.filter((id) => id !== c.value))
                                }
                                className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        <GeneratedText id="m_0ad82f94699bc5" />
                      </p>
                    )
                  }
                />
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
                  <GeneratedText id="m_112e2e8ecda428" />
                </Button>
                <Button type="submit" disabled={picked.length === 0}>
                  <Plus size={14} className="mr-1.5" />
                  <GeneratedText id="m_16c8592e5020a4" />{' '}
                  <GeneratedValue value={picked.length || ''} />{' '}
                  <GeneratedText id="m_1eccfcf56d888c" />
                  <GeneratedValue
                    value={picked.length === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                  />
                </Button>
              </div>
            </form>
          ) : null
        }
      />

      <GeneratedValue
        value={
          members.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              <GeneratedValue
                value={members.map((m) => {
                  const locked = m.isSelf || m.isProtectedSuperAdmin
                  const editing = editingId === m.assignmentId
                  return (
                    <li key={m.assignmentId} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedValue value={m.displayName ?? m.name} />
                            </span>
                            <GeneratedValue
                              value={
                                m.isSelf ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    <GeneratedText id="m_1f107a64fd97ca" />
                                  </Badge>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                m.isProtectedSuperAdmin ? (
                                  <Badge variant="warning" className="text-[10px]">
                                    <GeneratedText id="m_1db87d487dfb0a" />
                                  </Badge>
                                ) : null
                              }
                            />
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            <GeneratedValue value={m.email} />
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <GeneratedValue value={m.scopeLabel} />
                          </div>
                        </div>
                        <GeneratedValue
                          value={
                            !locked ? (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingId(editing ? null : m.assignmentId)}
                                >
                                  <GeneratedValue
                                    value={
                                      editing ? (
                                        <GeneratedText id="m_19ab80ae228d44" />
                                      ) : (
                                        <GeneratedText id="m_0a91fa2e617699" />
                                      )
                                    }
                                  />
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
                                    <GeneratedText id="m_1a9d8d971b1edb" />
                                  </Button>
                                </form>
                              </div>
                            ) : (
                              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                                <GeneratedText id="m_1527a5da6dd96c" />
                              </span>
                            )
                          }
                        />
                      </div>

                      <GeneratedValue
                        value={
                          editing ? (
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
                                  <GeneratedText id="m_00aacbd3c08b9c" />
                                </Button>
                              </div>
                            </form>
                          ) : null
                        }
                      />
                    </li>
                  )
                })}
              />
            </ul>
          ) : null
        }
      />
    </div>
  )
}
