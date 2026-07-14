import { isUuid } from '../../../../../lib/list-params'

export const NOTIFICATION_GROUP_LIMITS = {
  nameLength: 200,
  descriptionLength: 1_000,
  memberCount: 100,
  entityKeyLength: 200,
  previewSampleCount: 8,
} as const

export const NOTIFICATION_GROUP_COLORS = [
  '#0f766e',
  '#1d4ed8',
  '#b45309',
  '#b91c1c',
  '#7c3aed',
  '#0369a1',
  '#475569',
] as const

export const NOTIFICATION_GROUP_MEMBER_KINDS = [
  'everyone',
  'person',
  'role',
  'department',
  'org_unit',
  'trade',
  'crew',
  'person_group',
] as const

const NOTIFICATION_GROUP_MEMBER_MODES = ['include', 'exclude'] as const

export type NotificationGroupMemberKind = (typeof NOTIFICATION_GROUP_MEMBER_KINDS)[number]
export type NotificationGroupMemberMode = (typeof NOTIFICATION_GROUP_MEMBER_MODES)[number]
export type NotificationGroupMember = {
  kind: NotificationGroupMemberKind
  entityKey: string
  mode: NotificationGroupMemberMode
}

export type NotificationGroupDetails = {
  name: string
  description: string | null
  color: (typeof NOTIFICATION_GROUP_COLORS)[number] | null
  members: NotificationGroupMember[]
}

type NotificationGroupUpdate = NotificationGroupDetails & { id: string }

const UUID_MEMBER_KINDS = new Set<NotificationGroupMemberKind>([
  'person',
  'department',
  'org_unit',
  'trade',
  'crew',
  'person_group',
])
const GROUP_NAME_CONSTRAINT = 'notification_groups_tenant_name_ux'

function inputRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} is invalid.`)
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  if (value.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or less.`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  if (value.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or less.`)
  return value.trim() || null
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value as T[number]
}

function parseColor(value: unknown): NotificationGroupDetails['color'] {
  if (value == null || value === '') return null
  return enumValue(value, NOTIFICATION_GROUP_COLORS, 'Group colour')
}

function parseMember(value: unknown, index: number): NotificationGroupMember {
  const label = `Member ${index + 1}`
  const record = inputRecord(value, label)
  assertOnlyKeys(record, ['kind', 'entityKey', 'mode'], label)

  const kind = enumValue(record.kind, NOTIFICATION_GROUP_MEMBER_KINDS, `${label} kind`)
  const mode = enumValue(record.mode, NOTIFICATION_GROUP_MEMBER_MODES, `${label} mode`)
  if (typeof record.entityKey !== 'string') throw new Error(`${label} selection is invalid.`)
  if (record.entityKey.length > NOTIFICATION_GROUP_LIMITS.entityKeyLength) {
    throw new Error(
      `${label} selection must be ${NOTIFICATION_GROUP_LIMITS.entityKeyLength} characters or less.`,
    )
  }

  const entityKey = record.entityKey.trim()
  if (kind === 'everyone') {
    if (entityKey) throw new Error(`${label} cannot have a separate selection.`)
    return { kind, entityKey: '', mode }
  }
  if (!entityKey) throw new Error(`${label} needs a selection.`)
  if (UUID_MEMBER_KINDS.has(kind) && !isUuid(entityKey)) {
    throw new Error(`${label} selection is invalid.`)
  }
  return {
    kind,
    entityKey: UUID_MEMBER_KINDS.has(kind) ? entityKey.toLowerCase() : entityKey,
    mode,
  }
}

export function parseNotificationGroupMembers(value: unknown): NotificationGroupMember[] {
  if (!Array.isArray(value)) throw new Error('Group members are invalid.')
  if (value.length > NOTIFICATION_GROUP_LIMITS.memberCount) {
    throw new Error(
      `A group can have no more than ${NOTIFICATION_GROUP_LIMITS.memberCount} members.`,
    )
  }

  const members = value.map(parseMember)
  const seen = new Set<string>()
  for (const member of members) {
    const key = `${member.kind}:${member.entityKey}:${member.mode}`
    if (seen.has(key)) throw new Error('The group contains a duplicate member.')
    seen.add(key)
  }
  return members
}

function parseDetails(
  value: Record<string, unknown>,
  options: { membersRequired: boolean },
): NotificationGroupDetails {
  if (options.membersRequired && !Object.hasOwn(value, 'members')) {
    throw new Error('Group members are invalid.')
  }
  return {
    name: requiredText(value.name, 'Group name', NOTIFICATION_GROUP_LIMITS.nameLength),
    description: optionalText(
      value.description,
      'Group description',
      NOTIFICATION_GROUP_LIMITS.descriptionLength,
    ),
    color: parseColor(value.color),
    members: Object.hasOwn(value, 'members') ? parseNotificationGroupMembers(value.members) : [],
  }
}

export function parseNotificationGroupCreate(value: unknown): NotificationGroupDetails {
  const record = inputRecord(value, 'Group details')
  assertOnlyKeys(record, ['name', 'description', 'color', 'members'], 'Group details')
  return parseDetails(record, { membersRequired: false })
}

export function parseNotificationGroupUpdate(value: unknown): NotificationGroupUpdate {
  const record = inputRecord(value, 'Group details')
  assertOnlyKeys(record, ['id', 'name', 'description', 'color', 'members'], 'Group details')
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!isUuid(id)) throw new Error('Notification group is invalid.')
  return { id: id.toLowerCase(), ...parseDetails(record, { membersRequired: true }) }
}

export function parseNotificationGroupId(value: unknown): string {
  const record = inputRecord(value, 'Delete request')
  assertOnlyKeys(record, ['id'], 'Delete request')
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!isUuid(id)) throw new Error('Notification group is invalid.')
  return id.toLowerCase()
}

export function isNotificationGroupNameConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; constraint?: unknown; constraint_name?: unknown }
  const constraint = record.constraint_name ?? record.constraint
  return record.code === '23505' && constraint === GROUP_NAME_CONSTRAINT
}
