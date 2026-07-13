import { describe, expect, it } from 'vitest'
import { parseBhqlQuery, type AnalyticsEntity } from '@beaconhs/analytics'
import { discoverEntityMap, runBhql } from '@beaconhs/analytics/server'
import type { Database } from '@beaconhs/db'
import { REPORT_ENTITY_MAP, runCustomQuery } from '@beaconhs/reports'
import type { RequestContext } from '@beaconhs/tenant'
import {
  accessibleAnalyticsTemplates,
  analyticsAccessScopeKey,
  removeRawBuilderEntities,
} from './analytics-access-policy'

const INCIDENTS: AnalyticsEntity = {
  key: 'incidents',
  label: 'Incidents',
  category: 'Incidents',
  description: '',
  table: 'incidents',
  columns: [
    {
      key: 'site_id',
      label: 'Site',
      kind: 'uuid',
      semanticType: 'fk',
      canDimension: true,
      canMeasure: false,
      canBinTemporal: false,
      canBinNumeric: false,
    },
  ],
  relations: [{ via: 'form_id', target: 'form_responses', foreignColumn: 'id', label: 'Form' }],
}

function formEntity(id: string, label = 'App'): AnalyticsEntity {
  return {
    ...INCIDENTS,
    key: `form_responses:${id}`,
    label,
    table: 'form_responses',
    relations: [],
  }
}

function context(activeRoleId: string | null = null): RequestContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    isSuperAdmin: false,
    timezone: 'America/Toronto',
    membership: { id: 'member-1', displayName: 'Worker' },
    personId: 'person-1',
    permissions: new Set(['insights.read']),
    scopes: [{ type: 'tenant' }],
    activeRoleId,
    db: async () => {
      throw new Error('Database access is not expected')
    },
  }
}

const ALLOWED_ID = '018f47ba-86c4-7ee2-8d7a-5e7602f2a001'
const HIDDEN_ID = '018f47ba-86c4-7ee2-8d7a-5e7602f2a002'

describe('analytics Builder authorization policy', () => {
  it('keeps raw and arbitrary scoped Builder keys out of the engine default map', () => {
    const map = discoverEntityMap()
    expect(map.form_responses).toBeUndefined()
    expect(map.form_templates).toBeUndefined()
    expect(map[`form_responses:${HIDDEN_ID}`]).toBeUndefined()
    expect(Object.values(map).some((entity) => entity.table.startsWith('form_'))).toBe(false)
  })

  it('excludes draft and active-role-hidden apps from discovery', () => {
    const visible = accessibleAnalyticsTemplates(
      context('worker-role'),
      [
        {
          id: ALLOWED_ID,
          name: 'Open app',
          status: 'published',
          allowedRoles: ['worker'],
          deletedAt: null,
        },
        {
          id: HIDDEN_ID,
          name: 'Manager app',
          status: 'published',
          allowedRoles: ['manager'],
          deletedAt: null,
        },
        {
          id: '018f47ba-86c4-7ee2-8d7a-5e7602f2a003',
          name: 'Draft app',
          status: 'draft',
          allowedRoles: ['worker'],
          deletedAt: null,
        },
      ],
      new Set(['worker']),
    )
    expect(visible.map((template) => template.id)).toEqual([ALLOWED_ID])
  })

  it('removes raw form plumbing and relations into it', () => {
    const safe = removeRawBuilderEntities([
      INCIDENTS,
      { ...INCIDENTS, key: 'form_responses', table: 'form_responses' },
      { ...INCIDENTS, key: 'form_templates', table: 'form_templates' },
      formEntity(ALLOWED_ID),
    ])
    expect(safe.map((entity) => entity.key)).toEqual(['incidents', `form_responses:${ALLOWED_ID}`])
    expect(safe[0]?.relations).toEqual([])
  })

  it('rejects raw, arbitrary, joined, and spine Builder sources', () => {
    const entityMap = {
      incidents: INCIDENTS,
      [`form_responses:${ALLOWED_ID}`]: formEntity(ALLOWED_ID),
    }
    const query = (source: string) => ({
      version: 'bhql/1',
      display: 'table',
      stages: [{ source, aggregations: [{ fn: 'count', alias: 'count' }] }],
    })
    expect(() => parseBhqlQuery(query('form_responses'), entityMap)).toThrow(/Unknown source/)
    expect(() => parseBhqlQuery(query(`form_responses:${HIDDEN_ID}`), entityMap)).toThrow(
      /Unknown source/,
    )
    expect(() =>
      parseBhqlQuery(
        {
          ...query('incidents'),
          stages: [
            {
              source: 'incidents',
              breakouts: [{ field: 'site_id', alias: 'site' }],
              aggregations: [{ fn: 'count', alias: 'count' }],
              joinedSources: [
                {
                  source: `form_responses:${HIDDEN_ID}`,
                  measures: [{ fn: 'count', alias: 'hidden' }],
                  on: [{ breakout: 'site', field: 'site_id' }],
                },
              ],
            },
          ],
        },
        entityMap,
      ),
    ).toThrow(/Unknown joined source/)
    expect(() =>
      parseBhqlQuery(
        {
          ...query('incidents'),
          stages: [
            {
              source: 'incidents',
              spine: {
                dimensions: [{ source: `form_responses:${HIDDEN_ID}`, alias: 'hidden' }],
              },
              aggregations: [{ fn: 'count', alias: 'count' }],
            },
          ],
        },
        entityMap,
      ),
    ).toThrow(/Unknown source entity/)
  })

  it('re-validates a referenced metric source against the caller access map', async () => {
    const metricQuery = {
      version: 'bhql/1',
      display: 'table',
      stages: [
        {
          source: `form_responses:${HIDDEN_ID}`,
          aggregations: [{ fn: 'count', alias: 'count' }],
        },
      ],
    }
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ query: metricQuery, config: null }],
          }),
        }),
      }),
      execute: async () => {
        throw new Error('A rejected metric must not execute SQL')
      },
    } as unknown as Database
    const query = {
      version: 'bhql/1',
      display: 'table',
      stages: [
        {
          source: 'incidents',
          breakouts: [{ field: 'site_id', alias: 'site' }],
          aggregations: [{ fn: 'count', alias: 'count' }],
          metricRefs: [
            {
              metricId: '018f47ba-86c4-7ee2-8d7a-5e7602f2a004',
              alias: 'hidden_metric',
              on: [{ breakout: 'site', field: 'site_id' }],
            },
          ],
        },
      ],
    }
    await expect(runBhql(tx, query, { entityMap: { incidents: INCIDENTS } })).rejects.toThrow(
      /Unknown joined source/,
    )
  })

  it('does not fall back to static raw form entities for custom reports', async () => {
    expect(REPORT_ENTITY_MAP.form_responses).toBeUndefined()
    expect(REPORT_ENTITY_MAP.form_participants).toBeUndefined()
    const tx = {
      execute: async () => {
        throw new Error('A rejected report must not execute SQL')
      },
    } as unknown as Database
    await expect(
      runCustomQuery(
        tx,
        { entity: 'form_responses', mode: 'rows', columns: ['status'] },
        { entityMap: { incidents: INCIDENTS } },
      ),
    ).rejects.toThrow(/unknown entity/i)
  })

  it('isolates dashboard cache namespaces by active role and authorized apps', () => {
    const worker = analyticsAccessScopeKey({
      activeRoleId: 'worker-role',
      effectiveRoleKeys: new Set(['worker']),
      templateIds: [ALLOWED_ID],
    })
    const manager = analyticsAccessScopeKey({
      activeRoleId: 'manager-role',
      effectiveRoleKeys: new Set(['manager']),
      templateIds: [ALLOWED_ID],
    })
    const revoked = analyticsAccessScopeKey({
      activeRoleId: 'worker-role',
      effectiveRoleKeys: new Set(['worker']),
      templateIds: [],
    })
    expect(worker).not.toBe(manager)
    expect(worker).not.toBe(revoked)
  })
})
