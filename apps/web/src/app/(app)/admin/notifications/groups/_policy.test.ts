import { describe, expect, it } from 'vitest'
import {
  isNotificationGroupNameConflict,
  NOTIFICATION_GROUP_COLORS,
  NOTIFICATION_GROUP_LIMITS,
  parseNotificationGroupCreate,
  parseNotificationGroupId,
  parseNotificationGroupMembers,
  parseNotificationGroupUpdate,
} from './_policy'

const ID = '10000000-0000-4000-8000-000000000001'

describe('notification group mutation policy', () => {
  it('normalizes a valid group without dropping its members', () => {
    expect(
      parseNotificationGroupCreate({
        name: '  Site Supervisors  ',
        description: '  Primary escalation audience  ',
        color: NOTIFICATION_GROUP_COLORS[0],
        members: [
          { kind: 'role', entityKey: 'site_supervisor', mode: 'include' },
          { kind: 'person', entityKey: ID.toUpperCase(), mode: 'exclude' },
          { kind: 'everyone', entityKey: ' ', mode: 'include' },
        ],
      }),
    ).toEqual({
      name: 'Site Supervisors',
      description: 'Primary escalation audience',
      color: NOTIFICATION_GROUP_COLORS[0],
      members: [
        { kind: 'role', entityKey: 'site_supervisor', mode: 'include' },
        { kind: 'person', entityKey: ID, mode: 'exclude' },
        { kind: 'everyone', entityKey: '', mode: 'include' },
      ],
    })
  })

  it('rejects malformed runtime objects and unrecognized fields', () => {
    expect(() => parseNotificationGroupCreate(null)).toThrow(/Group details is invalid/)
    expect(() =>
      parseNotificationGroupCreate({ name: 'Ops', members: [], unexpected: true }),
    ).toThrow(/Group details is invalid/)
    expect(() =>
      parseNotificationGroupMembers([
        { kind: 'role', entityKey: 'worker', mode: 'include', ignored: true },
      ]),
    ).toThrow(/Member 1 is invalid/)
    expect(() => parseNotificationGroupId({ id: ID, ignored: true })).toThrow(
      /Delete request is invalid/,
    )
  })

  it('enforces exact member kinds, modes, UUIDs, and everyone semantics', () => {
    expect(() =>
      parseNotificationGroupMembers([{ kind: 'ROLE', entityKey: 'worker', mode: 'include' }]),
    ).toThrow(/kind is invalid/)
    expect(() =>
      parseNotificationGroupMembers([{ kind: 'role', entityKey: 'worker', mode: 'included' }]),
    ).toThrow(/mode is invalid/)
    expect(() =>
      parseNotificationGroupMembers([{ kind: 'crew', entityKey: 'not-a-uuid', mode: 'include' }]),
    ).toThrow(/selection is invalid/)
    expect(() =>
      parseNotificationGroupMembers([{ kind: 'everyone', entityKey: ID, mode: 'include' }]),
    ).toThrow(/cannot have a separate selection/)
  })

  it('rejects oversized fields, member sets, entity keys, and duplicates', () => {
    expect(() =>
      parseNotificationGroupCreate({
        name: 'x'.repeat(NOTIFICATION_GROUP_LIMITS.nameLength + 1),
      }),
    ).toThrow(/200 characters or less/)
    expect(() =>
      parseNotificationGroupCreate({
        name: 'Ops',
        description: 'x'.repeat(NOTIFICATION_GROUP_LIMITS.descriptionLength + 1),
      }),
    ).toThrow(/1000 characters or less/)
    expect(() =>
      parseNotificationGroupMembers(
        Array.from({ length: NOTIFICATION_GROUP_LIMITS.memberCount + 1 }, () => ({
          kind: 'role',
          entityKey: 'worker',
          mode: 'include',
        })),
      ),
    ).toThrow(/no more than 100 members/)
    expect(() =>
      parseNotificationGroupMembers([
        {
          kind: 'role',
          entityKey: 'x'.repeat(NOTIFICATION_GROUP_LIMITS.entityKeyLength + 1),
          mode: 'include',
        },
      ]),
    ).toThrow(/200 characters or less/)
    expect(() =>
      parseNotificationGroupMembers([
        { kind: 'role', entityKey: 'worker', mode: 'include' },
        { kind: 'role', entityKey: 'worker', mode: 'include' },
      ]),
    ).toThrow(/duplicate member/)
  })

  it('requires update and delete UUIDs and an explicit update member array', () => {
    expect(() => parseNotificationGroupUpdate({ id: 'bad', name: 'Ops', members: [] })).toThrow(
      /Notification group is invalid/,
    )
    expect(() => parseNotificationGroupUpdate({ id: ID, name: 'Ops' })).toThrow(
      /Group members are invalid/,
    )
    expect(() => parseNotificationGroupId({ id: 'bad' })).toThrow(/Notification group is invalid/)
  })

  it('identifies only the notification-group name constraint as a name conflict', () => {
    expect(
      isNotificationGroupNameConflict({
        code: '23505',
        constraint_name: 'notification_groups_tenant_name_ux',
      }),
    ).toBe(true)
    expect(
      isNotificationGroupNameConflict({
        code: '23505',
        constraint_name: 'notification_group_members_unique_ux',
      }),
    ).toBe(false)
    expect(isNotificationGroupNameConflict({ code: '23505' })).toBe(false)
    expect(isNotificationGroupNameConflict(new Error('database unavailable'))).toBe(false)
  })
})
