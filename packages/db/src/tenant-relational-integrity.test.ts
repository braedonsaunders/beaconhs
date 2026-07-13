import { createHash } from 'node:crypto'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'

type TableConfig = ReturnType<typeof getTableConfig>

type TenantForeignKey = {
  childTable: string
  childColumns: string[]
  parentTable: string
  parentColumns: string[]
}

function allTableConfigs(): TableConfig[] {
  const byName = new Map<string, TableConfig>()
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== 'object') continue
    try {
      const config = getTableConfig(value as Parameters<typeof getTableConfig>[0])
      if (config.name && config.columns.length > 0) byName.set(config.name, config)
    } catch {
      // enums, relations, and type-only exports are not tables
    }
  }
  return [...byName.values()]
}

function tenantForeignKeys(): TenantForeignKey[] {
  const tables = allTableConfigs()
  const tenantTables = new Set(
    tables.filter((table) => table.columns.some((column) => column.name === 'tenant_id')),
  )
  const tenantTableNames = new Set([...tenantTables].map((table) => table.name))

  return [...tenantTables].flatMap((table) =>
    table.foreignKeys.flatMap((foreignKey) => {
      const target = foreignKey.reference()
      const parentTable = getTableConfig(target.foreignTable).name
      if (!tenantTableNames.has(parentTable)) return []
      return [
        {
          childTable: table.name,
          childColumns: target.columns.map((column) => column.name),
          parentTable,
          parentColumns: target.foreignColumns.map((column) => column.name),
        },
      ]
    }),
  )
}

function signature(reference: TenantForeignKey): string {
  return `${reference.childTable}.${reference.childColumns.join(',')}->${reference.parentTable}.${reference.parentColumns.join(',')}`
}

const hardenedWorkflowPrincipalReferences = [
  'flow_gates.tenant_id,assignee_tenant_user_id->tenant_users.tenant_id,id',
  'flow_gates.tenant_id,decided_by_tenant_user_id->tenant_users.tenant_id,id',
  'form_response_checkins.tenant_id,by_tenant_user_id->tenant_users.tenant_id,id',
  'form_response_comments.tenant_id,author_tenant_user_id->tenant_users.tenant_id,id',
  'form_response_steps.tenant_id,assignee_tenant_user_id->tenant_users.tenant_id,id',
  'form_response_steps.tenant_id,rejected_by_tenant_user_id->tenant_users.tenant_id,id',
  'form_response_steps.tenant_id,signed_by_tenant_user_id->tenant_users.tenant_id,id',
  'form_responses.tenant_id,locked_by_tenant_user_id->tenant_users.tenant_id,id',
  'form_responses.tenant_id,submitted_by->tenant_users.tenant_id,id',
] as const

const hardenedRoutingReferences = [
  {
    reference: 'data_source_rows.tenant_id,data_source_id->data_sources.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'data_sources.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
    onDelete: 'no action',
  },
  {
    reference: 'notification_group_members.tenant_id,group_id->notification_groups.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'sync_crosswalk.tenant_id,connection_id->sync_connections.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'sync_record_changes.tenant_id,connection_id->sync_connections.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'sync_record_changes.tenant_id,run_id->sync_runs.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'sync_runs.tenant_id,connection_id->sync_connections.tenant_id,id',
    onDelete: 'cascade',
  },
] as const

const hardenedComplianceDispatchReferences = [
  {
    reference: 'compliance_audience.tenant_id,obligation_id->compliance_obligations.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'compliance_dispatches.tenant_id,obligation_id->compliance_obligations.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference:
      'compliance_obligations.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
    onDelete: 'no action',
  },
  {
    reference: 'compliance_status.tenant_id,obligation_id->compliance_obligations.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'compliance_status.tenant_id,person_id->people.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'form_assignment_dispatches.tenant_id,assignment_id->form_assignments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference:
      'inspection_assignment_compliance.tenant_id,assignment_id->inspection_assignments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference: 'inspection_assignment_compliance.tenant_id,person_id->people.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference:
      'inspection_assignment_dispatches.tenant_id,assignment_id->inspection_assignments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    reference:
      'journal_assignment_dispatches.tenant_id,assignment_id->journal_assignments.tenant_id,id',
    onDelete: 'cascade',
  },
] as const

const hardenedCriticalReferences = [
  'ai_conversation_shares.tenant_id,conversation_id->ai_conversations.tenant_id,id',
  'ai_conversation_shares.tenant_id,target_role_id->roles.tenant_id,id',
  'ai_conversation_shares.tenant_id,target_user_id->tenant_users.tenant_id,user_id',
  'ai_messages.tenant_id,conversation_id->ai_conversations.tenant_id,id',
  'api_idempotency_keys.tenant_id,api_key_id->api_keys.tenant_id,id',
  ...hardenedWorkflowPrincipalReferences,
  ...hardenedRoutingReferences.map(({ reference }) => reference),
  ...hardenedComplianceDispatchReferences.map(({ reference }) => reference),
  'role_assignments.tenant_id,role_id->roles.tenant_id,id',
  'role_assignments.tenant_id,tenant_user_id->tenant_users.tenant_id,id',
  'role_dashboard_layouts.tenant_id,role_id->roles.tenant_id,id',
  'user_permission_overrides.tenant_id,tenant_user_id->tenant_users.tenant_id,id',
]

describe('tenant relational integrity', () => {
  it('keeps security-critical ownership and workflow principals tenant-bound', () => {
    const compositeReferences = tenantForeignKeys()
      .filter((reference) => reference.childColumns.includes('tenant_id'))
      .map(signature)

    expect(compositeReferences).toEqual(expect.arrayContaining(hardenedCriticalReferences))
  })

  it('preserves delete actions and child indexes for hardened tenant relationships', () => {
    const tables = allTableConfigs()
    const tablesByName = new Map(tables.map((table) => [table.name, table]))
    const foreignKeysBySignature = new Map(
      tables.flatMap((table) =>
        table.foreignKeys.map((foreignKey) => {
          const target = foreignKey.reference()
          return [
            signature({
              childTable: table.name,
              childColumns: target.columns.map((column) => column.name),
              parentTable: getTableConfig(target.foreignTable).name,
              parentColumns: target.foreignColumns.map((column) => column.name),
            }),
            foreignKey,
          ] as const
        }),
      ),
    )

    const expectedReferences = [
      ...hardenedWorkflowPrincipalReferences.map((reference) => ({
        reference,
        onDelete: 'no action' as const,
      })),
      ...hardenedRoutingReferences,
      ...hardenedComplianceDispatchReferences,
    ]

    for (const { reference, onDelete } of expectedReferences) {
      expect(foreignKeysBySignature.get(reference)?.onDelete, reference).toBe(onDelete)
      const [child] = reference.split('->')
      const [tableName, columnList] = child!.split('.')
      const childColumns = columnList!.split(',')
      const hasSupportingIndex = tablesByName.get(tableName!)!.indexes.some((candidate) => {
        const indexColumns = candidate.config.columns.map((column) =>
          'name' in column ? column.name : '',
        )
        return childColumns.every((column, index) => indexColumns[index] === column)
      })
      expect(hasSupportingIndex, `${reference} child index`).toBe(true)
    }
  })

  it('makes AI share target shape and deduplication database invariants', () => {
    const shares = allTableConfigs().find((table) => table.name === 'ai_conversation_shares')
    expect(shares).toBeDefined()
    expect(shares!.checks.map((constraint) => constraint.name)).toContain(
      'ai_conversation_shares_target_shape_ck',
    )
    const uniqueIndexes = shares!.indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.name)
    expect(uniqueIndexes).toEqual(
      expect.arrayContaining(['ai_conversation_shares_user_ux', 'ai_conversation_shares_role_ux']),
    )
  })

  it('backs every composite tenant FK with an exact parent unique key', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    const compositeReferences = tenantForeignKeys().filter((reference) =>
      reference.childColumns.includes('tenant_id'),
    )

    for (const reference of compositeReferences) {
      const parent = tables.get(reference.parentTable)
      expect(parent, reference.parentTable).toBeDefined()
      const uniqueKeys = [
        ...parent!.indexes
          .filter((index) => index.config.unique)
          .map((index) =>
            index.config.columns.map((column) => ('name' in column ? column.name : '')),
          ),
        ...parent!.uniqueConstraints.map((constraint) =>
          constraint.columns.map((column) => column.name),
        ),
      ]
      expect(uniqueKeys, signature(reference)).toContainEqual(reference.parentColumns)
    }
  })

  it('ratchets the reviewed residual single-column tenant FK manifest', () => {
    const residual = tenantForeignKeys()
      .filter((reference) => !reference.childColumns.includes('tenant_id'))
      .map(signature)
      .sort()
    const digest = createHash('sha256').update(residual.join('\n')).digest('hex')

    // This is a deliberate ratchet, not acceptance that the residual edges are
    // safe. Any added, removed, or retargeted edge requires a fresh integrity
    // review. The architecture audit ranks the remaining conversion batches.
    expect(residual).toHaveLength(274)
    expect(digest).toBe('5da04fa62a6829afb61b4493c61d7e64863d809652ead952788d6b3ff30a4a69')
    expect(residual).toMatchSnapshot()
  })
})
