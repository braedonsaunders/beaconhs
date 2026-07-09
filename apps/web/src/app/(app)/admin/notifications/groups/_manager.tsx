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
  SearchSelect,
  Select,
  Textarea,
  type SelectOption,
} from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import type { AudienceOptions } from './_options'
import { createGroup, deleteGroup, previewGroup, updateGroup } from './_actions'

type MemberKind =
  | 'everyone'
  | 'person'
  | 'role'
  | 'department'
  | 'org_unit'
  | 'trade'
  | 'crew'
  | 'person_group'
type Member = { kind: MemberKind; entityKey: string; mode: 'include' | 'exclude' }
export type GroupRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  members: Member[]
}

const KIND_LABEL: Record<MemberKind, string> = {
  role: 'Role',
  department: 'Department',
  org_unit: 'Site / org unit',
  crew: 'Crew',
  trade: 'Trade',
  person_group: 'People group',
  person: 'Person',
  everyone: 'Everyone',
}
const KIND_OPTIONS: MemberKind[] = [
  'role',
  'department',
  'org_unit',
  'crew',
  'trade',
  'person_group',
  'person',
  'everyone',
]
const SWATCHES = ['#0f766e', '#1d4ed8', '#b45309', '#b91c1c', '#7c3aed', '#0369a1', '#475569']

function optionsFor(kind: MemberKind, o: AudienceOptions): SelectOption[] {
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

function labelFor(m: Member, o: AudienceOptions): string {
  if (m.kind === 'everyone') return 'Everyone'
  const hit = optionsFor(m.kind, o).find((x) => x.value === m.entityKey)
  return `${KIND_LABEL[m.kind]}: ${hit?.label ?? m.entityKey}`
}

function memberSummary(members: Member[]): string {
  if (members.length === 0) return 'No members yet'
  const inc = members.filter((m) => m.mode === 'include').length
  const exc = members.filter((m) => m.mode === 'exclude').length
  return `${inc} included${exc > 0 ? ` · ${exc} excluded` : ''}`
}

export function NotificationGroupsManager({
  groups,
  options,
}: {
  groups: GroupRow[]
  options: AudienceOptions
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<GroupRow | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {groups.length} group{groups.length === 1 ? '' : 's'}
        </p>
        <Button onClick={() => setEditing('new')}>
          <Plus size={14} /> New group
        </Button>
      </div>

      {groups.length === 0 ? (
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
  const [color, setColor] = React.useState(group?.color ?? SWATCHES[0]!)
  const [members, setMembers] = React.useState<Member[]>(group?.members ?? [])
  const [pending, start] = React.useTransition()
  const [preview, setPreview] = React.useState<{
    count: number
    withEmail: number
    sample: string[]
  } | null>(null)
  const [previewing, setPreviewing] = React.useState(false)

  // Live preview — debounced resolve of the current member set.
  React.useEffect(() => {
    if (members.length === 0) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    const t = setTimeout(() => {
      previewGroup(members)
        .then(setPreview)
        .finally(() => setPreviewing(false))
    }, 450)
    return () => clearTimeout(t)
  }, [members])

  function addMember() {
    setMembers((m) => [...m, { kind: 'role', entityKey: '', mode: 'include' }])
  }
  function updateMember(i: number, patch: Partial<Member>) {
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
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this group is for"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Colour</Label>
          <div className="flex items-center gap-1.5">
            {SWATCHES.map((c) => (
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
            <Label>Members</Label>
            <Button variant="outline" size="sm" onClick={addMember}>
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
                      updateMember(i, { kind: e.target.value as MemberKind, entityKey: '' })
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
                      <SearchSelect
                        value={m.entityKey}
                        options={optionsFor(m.kind, options)}
                        placeholder={`Choose a ${KIND_LABEL[m.kind].toLowerCase()}`}
                        searchPlaceholder="Search…"
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
            {previewing ? (
              <span className="text-slate-500">Resolving…</span>
            ) : preview ? (
              <span>
                Reaches {preview.count} {preview.count === 1 ? 'person' : 'people'} ·{' '}
                {preview.withEmail} with email
              </span>
            ) : (
              <span className="text-slate-500">Add members to see who this reaches</span>
            )}
          </div>
          {preview && preview.sample.length > 0 ? (
            <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-300/80">
              {preview.sample.join(', ')}
              {preview.count > preview.sample.length ? ', …' : ''}
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  )
}
