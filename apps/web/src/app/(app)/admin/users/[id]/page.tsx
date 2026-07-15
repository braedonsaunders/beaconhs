import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  cn,
} from '@beaconhs/ui'
import {
  roleAssignments,
  roles,
  tenantUsers,
  users as user,
  userPermissionOverrides,
  type RoleScope,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PERMISSION_GROUPS, permissionLabel } from '@/lib/permissions-meta'
import { PersonSelectField } from '@/components/person-select-field'
import { ScopePicker } from '../_components/scope-picker'
import { ConfirmButton } from '@/components/confirm-button'
import { loadScopeOptions, describeScope } from '../_scope-data'
import {
  assignRole,
  clearPermissionOverride,
  loadPersonLinkData,
  removeAssignment,
  removeMember,
  resendInvite,
  setMemberStatus,
  setPermissionOverride,
  setUserPersonLink,
  startImpersonation,
  updateMemberDisplayName,
} from '../_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1263b3d4e86af6') }
}
export const dynamic = 'force-dynamic'

const TABS = ['overview', 'roles', 'permissions', 'activity'] as const

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.users.manage')) redirect('/admin')
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'overview')
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined

  const data = await ctx.db(async (tx) => {
    const [member] = await tx
      .select({ membership: tenantUsers, account: user })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(tenantUsers.id, id))
      .limit(1)
    if (!member) return null
    const assignments = await tx
      .select({ assignment: roleAssignments, role: roles })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, id))
    const allRoles = await tx
      .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
      .from(roles)
      .orderBy(asc(roles.name))
    const overrides = await tx
      .select({
        permission: userPermissionOverrides.permission,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.tenantUserId, id))
    return { member, assignments, allRoles, overrides }
  })

  if (!data) notFound()
  const { member, assignments, allRoles, overrides } = data
  const scopeOptions = await loadScopeOptions(ctx)
  const personLink = await loadPersonLinkData(ctx, member.account.id)
  const activity = await recentActivityForEntity(ctx, 'tenant_user', id)

  const displayName = member.membership.displayName ?? member.account.name
  const canEditPersonLink = ctx.isSuperAdmin || !member.account.isSuperAdmin
  // "View as": needs the impersonate permission, an active non-super-admin
  // target that isn't yourself, and that you're not already impersonating.
  const canImpersonate =
    can(ctx, 'admin.users.impersonate') &&
    !ctx.impersonation &&
    member.membership.userId !== ctx.userId &&
    !member.account.isSuperAdmin &&
    member.membership.status === 'active'

  // Effective permissions: union of assigned roles' permissions, then overrides.
  const rolePerms = new Set<string>()
  for (const a of assignments) for (const p of a.role.permissions) rolePerms.add(p)
  const overrideMap = new Map(overrides.map((o) => [o.permission, o.effect] as const))

  const basePath = `/admin/users/${id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/users', label: 'Back to users' }}
          title={tGeneratedValue(displayName)}
          subtitle={tGeneratedValue(member.account.email)}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  member.membership.status === 'active'
                    ? 'success'
                    : member.membership.status === 'invited'
                      ? 'secondary'
                      : 'destructive'
                }
              >
                <GeneratedValue value={member.membership.status} />
              </Badge>
              <GeneratedValue
                value={
                  member.account.isSuperAdmin ? (
                    <Badge variant="warning">
                      <GeneratedText id="m_1ee09be62a0f9f" />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
        />

        <GeneratedValue
          value={
            error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <GeneratedValue value={error} />
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            notice ? (
              <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                <GeneratedValue value={notice} />
              </div>
            ) : null
          }
        />

        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'roles', label: 'Roles & scope', count: assignments.length },
            { key: 'permissions', label: 'Permissions' },
            { key: 'activity', label: 'Activity' },
          ]}
        />

        <GeneratedValue
          value={
            active === 'overview' ? (
              <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_087c02cfd3d740" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                        <dt className="text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_12397e5dea0794" />
                        </dt>
                        <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={member.account.name} />
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_00a0ba9938bdff" />
                        </dt>
                        <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={member.account.email} />
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_00b9a2f359be11" />
                        </dt>
                        <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                          <GeneratedValue
                            value={
                              member.membership.joinedAt
                                ? formatDate(
                                    new Date(member.membership.joinedAt),
                                    ctx.timezone,
                                    ctx.locale,
                                  )
                                : '—'
                            }
                          />
                        </dd>
                      </dl>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_089e8ed8b0bbae" />
                        <GeneratedValue value={' '} />
                        <strong>
                          <GeneratedText id="m_13bbdd4875314f" />
                        </strong>
                        <GeneratedText id="m_0ac0ee2cfecb9f" />
                      </p>
                      <form action={updateMemberDisplayName} className="space-y-1.5">
                        <input type="hidden" name="membershipId" value={id} />
                        <Label htmlFor="displayName">
                          <GeneratedText id="m_137fba41ce8b24" />
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="displayName"
                            name="displayName"
                            defaultValue={member.membership.displayName ?? ''}
                            placeholder={tGeneratedValue(member.account.name)}
                          />
                          <Button type="submit" variant="outline">
                            <GeneratedText id="m_19e6bff894c3c7" />
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_1f229dcf895b90" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <GeneratedValue
                          value={
                            member.membership.status === 'active' ? (
                              <form action={setMemberStatus}>
                                <input type="hidden" name="membershipId" value={id} />
                                <input type="hidden" name="status" value="suspended" />
                                <Button type="submit" variant="outline">
                                  <GeneratedText id="m_01455dfc577991" />
                                </Button>
                              </form>
                            ) : member.membership.status === 'suspended' ? (
                              <form action={setMemberStatus}>
                                <input type="hidden" name="membershipId" value={id} />
                                <input type="hidden" name="status" value="active" />
                                <Button type="submit" variant="outline">
                                  <GeneratedText id="m_04766a3c4e3582" />
                                </Button>
                              </form>
                            ) : null
                          }
                        />
                        <GeneratedValue
                          value={
                            member.membership.status === 'invited' ? (
                              <form action={resendInvite}>
                                <input type="hidden" name="membershipId" value={id} />
                                <Button type="submit" variant="ghost">
                                  <GeneratedText id="m_103335c1de739f" />
                                </Button>
                              </form>
                            ) : null
                          }
                        />
                        <form action={removeMember}>
                          <input type="hidden" name="membershipId" value={id} />
                          <ConfirmButton
                            type="submit"
                            variant="destructive"
                            message={tGenerated('m_0aaf1ca8945a99', { value0: displayName })}
                          >
                            <GeneratedText id="m_0fe728aa4d43b9" />
                          </ConfirmButton>
                        </form>
                      </div>

                      <GeneratedValue
                        value={
                          canImpersonate ? (
                            <div className="rounded-md border border-rose-200 p-3 dark:border-rose-900/60">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                    <GeneratedText id="m_098a5f42dda83e" />
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_1c14bca6c46227" />{' '}
                                    <GeneratedValue value={displayName} />
                                    <GeneratedText id="m_06bee51417d703" />
                                  </p>
                                </div>
                                <form action={startImpersonation}>
                                  <input type="hidden" name="membershipId" value={id} />
                                  <ConfirmButton
                                    type="submit"
                                    variant="outline"
                                    message={tGenerated('m_024592eb041e2e', {
                                      value0: displayName,
                                    })}
                                  >
                                    <GeneratedText id="m_0db54ddafef7c4" />
                                  </ConfirmButton>
                                </form>
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_0434685cf97138" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1ca6cf074ffb12" />
                    </p>
                    <GeneratedValue
                      value={
                        canEditPersonLink ? (
                          <form action={setUserPersonLink} className="space-y-3">
                            <input type="hidden" name="membershipId" value={id} />
                            <div className="space-y-1.5">
                              <Label htmlFor="personId">
                                <GeneratedText id="m_094919f70d4c77" />
                              </Label>
                              <PersonSelectField
                                name="personId"
                                defaultValue={personLink.linked?.id ?? ''}
                                options={personLink.options.map((p) => ({
                                  value: p.id,
                                  label: p.name,
                                  hint: p.hint ?? undefined,
                                }))}
                                placeholder={tGenerated('m_0b08379f3f4b01')}
                                emptyLabel={tGenerated('m_0b08379f3f4b01')}
                              />
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedText id="m_1f6ae387091f59" />
                              </p>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <GeneratedValue
                                value={
                                  personLink.linked ? (
                                    <a
                                      href={`/people/${personLink.linked.id}`}
                                      className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                                    >
                                      <GeneratedText id="m_107ab58c3c38bc" />{' '}
                                      <GeneratedValue value={personLink.linked.name} /> →
                                    </a>
                                  ) : (
                                    <span />
                                  )
                                }
                              />
                              <Button type="submit" variant="outline">
                                <GeneratedText id="m_19e6bff894c3c7" />
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <p className="text-sm text-slate-700 dark:text-slate-200">
                            <GeneratedValue
                              value={
                                personLink.linked ? (
                                  <a
                                    href={`/people/${personLink.linked.id}`}
                                    className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    <GeneratedValue value={personLink.linked.name} />
                                  </a>
                                ) : (
                                  <GeneratedText id="m_12597365ce4941" />
                                )
                              }
                            />
                          </p>
                        )
                      }
                    />
                  </CardContent>
                </Card>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'roles' ? (
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_00fb06fb3ff018" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <GeneratedValue
                      value={
                        assignments.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            <GeneratedText id="m_1d8a95b48e4fe1" />
                          </p>
                        ) : (
                          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            <GeneratedValue
                              value={assignments.map((a) => (
                                <li
                                  key={a.assignment.id}
                                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium text-slate-900 dark:text-slate-100">
                                      <GeneratedValue value={a.role.name} />
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedValue
                                        value={describeScope(
                                          a.assignment.scope as RoleScope,
                                          scopeOptions,
                                        )}
                                      />
                                    </div>
                                  </div>
                                  <form action={removeAssignment}>
                                    <input type="hidden" name="membershipId" value={id} />
                                    <input
                                      type="hidden"
                                      name="assignmentId"
                                      value={a.assignment.id}
                                    />
                                    <Button type="submit" variant="ghost" size="sm">
                                      <GeneratedText id="m_1a9d8d971b1edb" />
                                    </Button>
                                  </form>
                                </li>
                              ))}
                            />
                          </ul>
                        )
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_0338003cb3157d" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form action={assignRole} className="space-y-4">
                      <input type="hidden" name="membershipId" value={id} />
                      <div className="space-y-1.5">
                        <Label htmlFor="roleId">
                          <GeneratedText id="m_1099c1fe8b6614" />
                        </Label>
                        <Select id="roleId" name="roleId" required defaultValue="">
                          <option value="" disabled>
                            <GeneratedText id="m_0e809cf3b04b55" />
                          </option>
                          <GeneratedValue
                            value={allRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                <GeneratedValue value={r.name} />
                              </option>
                            ))}
                          />
                        </Select>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_0453038ccb73ab" />
                        </p>
                      </div>
                      <ScopePicker
                        sites={scopeOptions.sites}
                        crews={scopeOptions.crews}
                        departments={scopeOptions.departments}
                        groups={scopeOptions.groups}
                        people={scopeOptions.people}
                      />
                      <div className="flex justify-end">
                        <Button type="submit">
                          <GeneratedText id="m_10d33aff52cf3f" />
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'permissions' ? (
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_1cfbbba3ba3872" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1cd6243befd3ea" />
                    </p>
                    <form action={setPermissionOverride} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="membershipId" value={id} />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor="permission">
                          <GeneratedText id="m_18994f4f4ed4b7" />
                        </Label>
                        <Select id="permission" name="permission" required defaultValue="">
                          <option value="" disabled>
                            <GeneratedText id="m_0bfcf661569a51" />
                          </option>
                          <GeneratedValue
                            value={PERMISSION_GROUPS.map((g) => (
                              <optgroup key={g.key} label={tGeneratedValue(g.label)}>
                                <GeneratedValue
                                  value={g.permissions.map((p) => (
                                    <option key={p.key} value={p.key}>
                                      <GeneratedValue value={p.label} />
                                    </option>
                                  ))}
                                />
                              </optgroup>
                            ))}
                          />
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="effect">
                          <GeneratedText id="m_08915780ab8677" />
                        </Label>
                        <Select id="effect" name="effect" defaultValue="grant" className="w-32">
                          <option value="grant">
                            <GeneratedText id="m_18e71b8872fe55" />
                          </option>
                          <option value="deny">
                            <GeneratedText id="m_0779a6056e2316" />
                          </option>
                        </Select>
                      </div>
                      <Button type="submit">
                        <GeneratedText id="m_01185cdc1c20a5" />
                      </Button>
                    </form>

                    <GeneratedValue
                      value={
                        overrides.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            <GeneratedValue
                              value={overrides.map((o) => (
                                <span
                                  key={o.permission}
                                  className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs font-medium',
                                    o.effect === 'grant'
                                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                                      : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                                  )}
                                >
                                  <GeneratedValue value={o.effect === 'grant' ? '＋' : '−'} />{' '}
                                  <GeneratedValue value={permissionLabel(o.permission)} />
                                  <form action={clearPermissionOverride}>
                                    <input type="hidden" name="membershipId" value={id} />
                                    <input type="hidden" name="permission" value={o.permission} />
                                    <button
                                      type="submit"
                                      aria-label={tGenerated('m_12d3b187f29bae', {
                                        value0: permissionLabel(o.permission),
                                      })}
                                      className="rounded-full px-1 hover:bg-black/5 dark:hover:bg-white/10"
                                    >
                                      ✕
                                    </button>
                                  </form>
                                </span>
                              ))}
                            />
                          </div>
                        ) : null
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_052cd76809f044" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <GeneratedValue
                      value={PERMISSION_GROUPS.map((g) => (
                        <div key={g.key} className="space-y-2">
                          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                            <GeneratedValue value={g.label} />
                          </h3>
                          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                            <GeneratedValue
                              value={g.permissions.map((p) => {
                                const ov = overrideMap.get(p.key)
                                const effective =
                                  ov === 'deny'
                                    ? false
                                    : ov === 'grant'
                                      ? true
                                      : rolePerms.has(p.key)
                                return (
                                  <li
                                    key={p.key}
                                    className="flex items-center justify-between gap-2 py-0.5 text-sm"
                                  >
                                    <span
                                      className={cn(
                                        effective
                                          ? 'text-slate-700 dark:text-slate-200'
                                          : 'text-slate-400 dark:text-slate-500',
                                      )}
                                    >
                                      <GeneratedValue value={p.label} />
                                    </span>
                                    <PermissionState inRole={rolePerms.has(p.key)} override={ov} />
                                  </li>
                                )
                              })}
                            />
                          </ul>
                        </div>
                      ))}
                    />
                  </CardContent>
                </Card>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'activity' ? (
              <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
            ) : null
          }
        />
      </div>
    </PageContainer>
  )
}

function PermissionState({
  inRole,
  override,
}: {
  inRole: boolean
  override: 'grant' | 'deny' | undefined
}) {
  if (override === 'deny')
    return (
      <Badge variant="destructive" className="text-[10px]">
        <GeneratedText id="m_1facd4aa3b5057" />
      </Badge>
    )
  if (override === 'grant')
    return (
      <Badge variant="success" className="text-[10px]">
        <GeneratedText id="m_0d198b4ab2693d" />
      </Badge>
    )
  if (inRole)
    return (
      <Badge variant="secondary" className="text-[10px]">
        <GeneratedText id="m_1e3c8995bd257d" />
      </Badge>
    )
  return <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
}
