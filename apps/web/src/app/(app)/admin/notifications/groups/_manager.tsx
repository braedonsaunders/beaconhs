'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [editing, setEditing] = React.useState<GroupRow | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder={tGenerated('m_0fd66932ffe849')} />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <GeneratedValue value={total.toLocaleString()} />{' '}
            <GeneratedValue value={hasSearch ? <GeneratedText id="m_05062e662db3c5" /> : ''} />
            <GeneratedText id="m_04659be4c4e726" />
            <GeneratedValue value={total === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />} />
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={14} /> <GeneratedText id="m_1cffae5082cb21" />
        </Button>
      </div>

      <GeneratedValue
        value={
          groups.length === 0 && total > 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title={tGenerated('m_1be5d8cca8b626')}
              description={tGenerated('m_1364361e81aa5c')}
            />
          ) : groups.length === 0 && hasSearch ? (
            <EmptyState
              icon={<Users size={24} />}
              title={tGenerated('m_144c691c15a3dd')}
              description={tGenerated('m_1321ee6e86e717')}
            />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title={tGenerated('m_0ef63f018d68aa')}
              description={tGenerated('m_1e357024f64886')}
              action={
                <Button variant="outline" onClick={() => setEditing('new')}>
                  <Plus size={14} /> <GeneratedText id="m_1ce910ec2d7bc2" />
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <GeneratedValue
                value={groups.map((g) => (
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
                          <GeneratedValue value={g.name} />
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={g.description || memberSummary(g.members)} />
                        </span>
                      </span>
                    </button>
                    <Badge variant="secondary">
                      <GeneratedValue value={memberSummary(g.members)} />
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => setEditing(g)}>
                      <GeneratedText id="m_03a66f9d34ac7b" />
                    </Button>
                  </li>
                ))}
              />
            </ul>
          )
        }
      />

      <GeneratedValue
        value={
          total > 0 ? (
            <Pagination
              basePath={basePath}
              currentParams={currentParams}
              total={total}
              page={page}
              perPage={perPage}
            />
          ) : null
        }
      />

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      toast.error(tGenerated('m_0b2a7701681b4d', { value0: NOTIFICATION_GROUP_LIMITS.memberCount }))
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
      toast.error(tGenerated('m_1a955a149161d3'))
      return
    }
    start(async () => {
      const payload = { name, description, color, members }
      const res = group
        ? await updateGroup({ id: group.id, ...payload })
        : await createGroup(payload)
      if (res.ok) {
        toast.success(
          tGeneratedValue(group ? tGenerated('m_1f00296b696e0d') : tGenerated('m_1fd94fc7149f90')),
        )
        onSaved()
      } else {
        toast.error(tGeneratedValue(res.error))
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
        toast.success(tGenerated('m_0c355fc3e24039'))
        onSaved()
      } else {
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tGeneratedValue(
        group ? tGenerated('m_16f388543b98cf') : tGenerated('m_1cffae5082cb21'),
      )}
      description={tGenerated('m_0fbcc6f09ce94a')}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <GeneratedValue
            value={
              group ? (
                <Button
                  variant="outline"
                  onClick={del}
                  disabled={pending}
                  className="text-rose-600"
                >
                  <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
                </Button>
              ) : (
                <span />
              )
            }
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button onClick={save} disabled={pending}>
              <GeneratedValue
                value={pending ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              />
              <GeneratedValue
                value={
                  group ? (
                    <GeneratedText id="m_19e6bff894c3c7" />
                  ) : (
                    <GeneratedText id="m_017309f0f9f564" />
                  )
                }
              />
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1a9978900838e6" />
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tGenerated('m_17a97164786185')}
            maxLength={NOTIFICATION_GROUP_LIMITS.nameLength}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tGenerated('m_147895675e1350')}
            maxLength={NOTIFICATION_GROUP_LIMITS.descriptionLength}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1242677f454516" />
          </Label>
          <div className="flex items-center gap-1.5">
            <GeneratedValue
              value={NOTIFICATION_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={tGenerated('m_146e65119955be', { value0: c })}
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              <GeneratedText id="m_1495e10d0698d6" />
              <GeneratedValue value={members.length} />/
              <GeneratedValue value={NOTIFICATION_GROUP_LIMITS.memberCount} />)
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addMember}
              disabled={members.length >= NOTIFICATION_GROUP_LIMITS.memberCount}
            >
              <Plus size={13} /> <GeneratedText id="m_0f3c6b203f7b59" />
            </Button>
          </div>
          <GeneratedValue
            value={
              members.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700">
                  <GeneratedText id="m_166c95d538c0f8" />
                </p>
              ) : (
                <ul className="space-y-2">
                  <GeneratedValue
                    value={members.map((m, i) => (
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
                          <option value="include">{'Include'}</option>
                          <option value="exclude">{'Exclude'}</option>
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
                        <GeneratedValue
                          value={
                            m.kind !== 'everyone' ? (
                              <div className="min-w-[10rem] flex-1">
                                <RemoteSearchSelect
                                  lookup={lookupFor(m.kind)}
                                  value={m.entityKey}
                                  initialOption={optionsFor(m.kind, options).find(
                                    (candidate) => candidate.value === m.entityKey,
                                  )}
                                  placeholder={tGenerated('m_1d7c7208545be9', {
                                    value0: KIND_LABEL[m.kind].toLowerCase(),
                                  })}
                                  searchPlaceholder={tGenerated('m_0c0f4b8e077d91')}
                                  sheetTitle={`Choose a ${KIND_LABEL[m.kind].toLowerCase()}`}
                                  ariaLabel={KIND_LABEL[m.kind]}
                                  onChange={(v) => updateMember(i, { entityKey: v })}
                                />
                              </div>
                            ) : (
                              <span className="flex-1 text-xs text-slate-500">
                                <GeneratedText id="m_008abd14d0ce99" />
                              </span>
                            )
                          }
                        />
                        <button
                          type="button"
                          onClick={() => removeMember(i)}
                          aria-label={tGenerated('m_13fbbf976f1841')}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40"
                        >
                          <X size={15} />
                        </button>
                      </li>
                    ))}
                  />
                </ul>
              )
            }
          />
        </div>

        <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/30">
          <div className="flex items-center gap-2 font-medium text-teal-900 dark:text-teal-200">
            <Users size={14} />
            <GeneratedValue
              value={
                resolvedPreviewing ? (
                  <span className="text-slate-500">
                    <GeneratedText id="m_0dca828cb92cbc" />
                  </span>
                ) : resolvedPreviewError ? (
                  <span className="text-rose-700 dark:text-rose-300">
                    <GeneratedValue value={resolvedPreviewError} />
                  </span>
                ) : resolvedPreview ? (
                  <span>
                    <GeneratedText id="m_010c0ce61be9ed" />{' '}
                    <GeneratedValue value={resolvedPreview.count} />{' '}
                    <GeneratedValue
                      value={
                        resolvedPreview.count === 1 ? (
                          <GeneratedText id="m_15ba73a802eb25" />
                        ) : (
                          <GeneratedText id="m_01376047f0528f" />
                        )
                      }
                    />
                    <GeneratedValue value={' '} />
                    · <GeneratedValue value={resolvedPreview.withEmail} />{' '}
                    <GeneratedText id="m_1aba932a5ea4ce" />
                  </span>
                ) : (
                  <span className="text-slate-500">
                    <GeneratedText id="m_1803ddd3590ecd" />
                  </span>
                )
              }
            />
          </div>
          <GeneratedValue
            value={
              resolvedPreview && resolvedPreview.sample.length > 0 ? (
                <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-300/80">
                  <GeneratedValue value={resolvedPreview.sample.join(', ')} />
                  <GeneratedValue
                    value={resolvedPreview.count > resolvedPreview.sample.length ? ', …' : ''}
                  />
                </p>
              ) : null
            }
          />
        </div>
      </div>
    </Drawer>
  )
}
