'use client'

// Notification-group manager: a list of reusable audiences + a composable
// member builder with a live "reaches N people" preview. Members union together
// (roles/departments/sites/crews/trades/people-groups/individuals), and
// `exclude` rows subtract people back out.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Users, X } from 'lucide-react'
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  Input,
  Label,
  Select,
  type SelectOption,
} from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { Pagination } from '@/components/pagination'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { SearchInput } from '@/components/search-input'
import type { PickerLookup } from '@/lib/picker-options'
import type { AudienceOptions } from './_options'
import { createGroup, deleteGroup, previewGroup, updateGroup } from './_actions'
import {
  NOTIFICATION_GROUP_COLORS,
  NOTIFICATION_GROUP_LIMITS,
  NOTIFICATION_GROUP_MEMBER_KINDS,
  type NotificationGroupMember,
  type NotificationGroupMemberKind,
} from './_policy'

export type GroupRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  members: NotificationGroupMember[]
}

const KIND_LABEL: Record<NotificationGroupMemberKind, string> = {
  role: 'Role',
  department: 'Department',
  org_unit: 'Site / org unit',
  crew: 'Crew',
  trade: 'Trade',
  person_group: 'People group',
  person: 'Person',
  everyone: 'Everyone',
}
const KIND_OPTIONS: NotificationGroupMemberKind[] = [
  ...NOTIFICATION_GROUP_MEMBER_KINDS.filter((kind) => kind !== 'everyone'),
  'everyone',
]

function optionsFor(kind: NotificationGroupMemberKind, o: AudienceOptions): SelectOption[] {
  switch (kind) {
    case 'person':
      return o.people.map((p) => ({ value: p.id, label: p.name }))
    case 'role':
      return o.roles.map((r) => ({ value: r.key, label: r.name }))
    case 'department':
      return o.departments.map((d) => ({ value: d.id, label: d.name }))
    case 'org_unit':
      return o.orgUnits.map((u) => ({ value: u.id, label: u.name }))
    case 'trade':
      return o.trades.map((t) => ({ value: t.id, label: t.name }))
    case 'crew':
      return o.crews.map((c) => ({ value: c.id, label: c.name }))
    case 'person_group':
      return o.personGroups.map((g) => ({ value: g.id, label: g.name }))
    default:
      return []
  }
}

function lookupFor(kind: Exclude<NotificationGroupMemberKind, 'everyone'>): PickerLookup {
  switch (kind) {
    case 'person':
      return 'notification-group-people'
    case 'role':
      return 'notification-group-roles'
    case 'department':
      return 'notification-group-departments'
    case 'org_unit':
      return 'notification-group-org-units'
    case 'trade':
      return 'notification-group-trades'
    case 'crew':
      return 'notification-group-crews'
    case 'person_group':
      return 'notification-group-person-groups'
  }
}

function memberSummary(members: NotificationGroupMember[]): string {
  if (members.length === 0) return 'No members yet'
  const inc = members.filter((m) => m.mode === 'include').length
  const exc = members.filter((m) => m.mode === 'exclude').length
  return `${inc} included${exc > 0 ? ` · ${exc} excluded` : ''}`
}

export function NotificationGroupsManager({
  groups,
  options,
  total,
  page,
  perPage,
  currentParams,
  hasSearch,
  basePath,
}: {
  groups: GroupRow[]
  options: AudienceOptions
  total: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
  hasSearch: boolean
  basePath: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<GroupRow | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="Search group name or description…" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {total.toLocaleString()} {hasSearch ? 'matching ' : ''}group
            {total === 1 ? '' : 's'}
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={14} /> New group
        </Button>
      </div>

      {groups.length === 0 && total > 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="This page is past the end of the results"
          description="Use the pagination control below to return to the last page."
        />
      ) : groups.length === 0 && hasSearch ? (
        <EmptyState
          icon={<Users size={24} />}
          title="No notification groups match your search"
          description="Try a different group name or description."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="No notification groups yet"
          description="Create a group like 'Site Supervisors' or 'First-Aid Responders' once, then target it from any alert."
          action={
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus size={14} /> Create the first group
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <button
                type="button"
                onClick={() => setEditing(g)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: g.color ?? '#94a3b8' }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {g.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {g.description || memberSummary(g.members)}
                  </span>
                </span>
              </button>
              <Badge variant="secondary">{memberSummary(g.members)}</Badge>
              <Button variant="outline" size="sm" onClick={() => setEditing(g)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      {total > 0 ? (
        <Pagination
          basePath={basePath}
          currentParams={currentParams}
          total={total}
          page={page}
          perPage={perPage}
        />
      ) : null}

      <GroupEditor
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        group={editing === 'new' ? null : editing}
        options={options}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          router.refresh()
        }}
      />
    </div>
  )
}

function GroupEditor({
  open,
  group,
  options,
  onClose,
  onSaved,
}: {
  open: boolean
  group: GroupRow | null
  options: AudienceOptions
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState(group?.name ?? '')
  const [description, setDescription] = React.useState(group?.description ?? '')
  const [color, setColor] = React.useState(
    NOTIFICATION_GROUP_COLORS.find((candidate) => candidate === group?.color) ??
      NOTIFICATION_GROUP_COLORS[0],
  )
  const [members, setMembers] = React.useState<NotificationGroupMember[]>(group?.members ?? [])
  const [pending, start] = React.useTransition()
  const [preview, setPreview] = React.useState<{
    count: number
    withEmail: number
    sample: string[]
  } | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const previewEligible =
    members.length > 0 &&
    members.every((member) => member.kind === 'everyone' || Boolean(member.entityKey))

  // Live preview — debounced resolve of the current member set.
  React.useEffect(() => {
    if (!previewEligible) return
    let cancelled = false
    const t = setTimeout(() => {
      setPreviewing(true)
      setPreviewError(null)
      previewGroup(members)
        .then((result) => {
          if (cancelled) return
          if (result.ok) {
            setPreview({ count: result.count, withEmail: result.withEmail, sample: result.sample })
          } else {
            setPreview(null)
            setPreviewError(result.error)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreview(null)
            setPreviewError('Could not resolve this preview. Please try again.')
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [members, previewEligible])

  const resolvedPreview = previewEligible ? preview : null
  const resolvedPreviewError = previewEligible ? previewError : null
  const resolvedPreviewing = previewEligible && previewing

  function addMember() {
    if (members.length >= NOTIFICATION_GROUP_LIMITS.memberCount) {
      toast.error(`A group can have no more than ${NOTIFICATION_GROUP_LIMITS.memberCount} members.`)
      return
    }
    setMembers((m) => [...m, { kind: 'role', entityKey: '', mode: 'include' }])
  }
  function updateMember(i: number, patch: Partial<NotificationGroupMember>) {
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }
  function removeMember(i: number) {
    setMembers((m) => m.filter((_, j) => j !== i))
  }

  function save() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    start(async () => {
      const payload = { name, description, color, members }
      const res = group
        ? await updateGroup({ id: group.id, ...payload })
        : await createGroup(payload)
      if (res.ok) {
        toast.success(group ? 'Group saved' : 'Group created')
        onSaved()
      } else {
        toast.error(res.error)
      }
    })
  }

  async function del() {
    if (!group) return
    if (
      !(await confirmDialog({
        message: `Delete "${group.name}"? Alerts targeting it will fall back to defaults.`,
        tone: 'danger',
      }))
    )
      return
    start(async () => {
      const res = await deleteGroup({ id: group.id })
      if (res.ok) {
        toast.success('Group deleted')
        onSaved()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={group ? 'Edit group' : 'New group'}
      description="Members union together. Add an Exclude row to remove specific people from the result."
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {group ? (
            <Button variant="outline" onClick={del} disabled={pending} className="text-rose-600">
              <Trash2 size={14} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {group ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Site Supervisors"
            maxLength={NOTIFICATION_GROUP_LIMITS.nameLength}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this group is for"
            maxLength={NOTIFICATION_GROUP_LIMITS.descriptionLength}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Colour</Label>
          <div className="flex items-center gap-1.5">
            {NOTIFICATION_GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              Members ({members.length}/{NOTIFICATION_GROUP_LIMITS.memberCount})
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addMember}
              disabled={members.length >= NOTIFICATION_GROUP_LIMITS.memberCount}
            >
              <Plus size={13} /> Add member
            </Button>
          </div>
          {members.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700">
              No members yet — add a role, department, crew, people group, or named person.
            </p>
          ) : (
            <ul className="space-y-2">
              {members.map((m, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800"
                >
                  <Select
                    value={m.mode}
                    triggerClassName="w-28"
                    onChange={(e) =>
                      updateMember(i, { mode: e.target.value as 'include' | 'exclude' })
                    }
                  >
                    <option value="include">Include</option>
                    <option value="exclude">Exclude</option>
                  </Select>
                  <Select
                    value={m.kind}
                    triggerClassName="w-40"
                    onChange={(e) =>
                      updateMember(i, {
                        kind: e.target.value as NotificationGroupMemberKind,
                        entityKey: '',
                      })
                    }
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                  {m.kind !== 'everyone' ? (
                    <div className="min-w-[10rem] flex-1">
                      <RemoteSearchSelect
                        lookup={lookupFor(m.kind)}
                        value={m.entityKey}
                        initialOption={optionsFor(m.kind, options).find(
                          (candidate) => candidate.value === m.entityKey,
                        )}
                        placeholder={`Choose a ${KIND_LABEL[m.kind].toLowerCase()}`}
                        searchPlaceholder="Search…"
                        sheetTitle={`Choose a ${KIND_LABEL[m.kind].toLowerCase()}`}
                        ariaLabel={KIND_LABEL[m.kind]}
                        onChange={(v) => updateMember(i, { entityKey: v })}
                      />
                    </div>
                  ) : (
                    <span className="flex-1 text-xs text-slate-500">
                      Every active person in the tenant
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMember(i)}
                    aria-label="Remove member"
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/30">
          <div className="flex items-center gap-2 font-medium text-teal-900 dark:text-teal-200">
            <Users size={14} />
            {resolvedPreviewing ? (
              <span className="text-slate-500">Resolving…</span>
            ) : resolvedPreviewError ? (
              <span className="text-rose-700 dark:text-rose-300">{resolvedPreviewError}</span>
            ) : resolvedPreview ? (
              <span>
                Reaches {resolvedPreview.count} {resolvedPreview.count === 1 ? 'person' : 'people'}{' '}
                · {resolvedPreview.withEmail} with email
              </span>
            ) : (
              <span className="text-slate-500">Add members to see who this reaches</span>
            )}
          </div>
          {resolvedPreview && resolvedPreview.sample.length > 0 ? (
            <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-300/80">
              {resolvedPreview.sample.join(', ')}
              {resolvedPreview.count > resolvedPreview.sample.length ? ', …' : ''}
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  )
}
