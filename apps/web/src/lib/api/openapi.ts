// OpenAPI 3.1 document, generated from the reports entity registry so the spec
// can never drift from what /api/v1/[entity] actually serves. Hand-built plain
// objects (no extra dependency): every path, schema and filter parameter is
// derived from REPORT_ENTITIES.

import { REPORT_ENTITIES, type ReportColumnKind, type ReportEntity } from '@beaconhs/reports'
import { DEFAULT_LIMIT, MAX_LIMIT } from './query'
import { readPermissionForEntity } from './permissions'
import { isRecordable } from './records'
import { isWritable, writeBodySchema, writePermissionForEntity } from './write'

type Json = Record<string, unknown>

function schemaForKind(kind: ReportColumnKind): Json {
  switch (kind) {
    case 'uuid':
      return { type: 'string', format: 'uuid' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'timestamp':
      return { type: 'string', format: 'date-time' }
    case 'number':
      return { type: 'number' }
    case 'text':
    case 'enum':
    default:
      return { type: 'string' }
  }
}

function pascalCase(key: string): string {
  return key
    .split(/[_\s-]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

function entitySchema(entity: ReportEntity): Json {
  const properties: Json = {}
  // Recordable entities expose their own id (first); views do not.
  if (isRecordable(entity.key)) {
    properties['id'] = { type: 'string', format: 'uuid', description: 'Record id' }
  }
  for (const col of entity.columns) {
    properties[col.key] = { ...schemaForKind(col.kind), description: col.label }
  }
  return {
    type: 'object',
    description: entity.description,
    properties,
  }
}

const errorContent = (): Json => ({
  'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
})

function entityPath(entity: ReportEntity): Json {
  const schemaName = pascalCase(entity.key)
  const columnKeys = entity.columns.map((c) => c.key)
  const readPermission = readPermissionForEntity(entity)

  const filterParams = entity.columns.map((col) => ({
    name: col.key,
    in: 'query',
    required: false,
    schema: schemaForKind(col.kind),
    description: `Filter by ${col.label} (equals). Operator suffixes: ${col.key}__gte, ${col.key}__lte, ${col.key}__neq, ${col.key}__in (comma-separated), ${col.key}__not_in, ${col.key}__contains, ${col.key}__is_null, ${col.key}__is_not_null.`,
  }))

  const operations: Json = {
    get: {
      tags: [entity.category],
      operationId: `list_${entity.key}`,
      summary: `List ${entity.label}`,
      description: `${entity.description}\n\nRequires permission \`${readPermission}\`. Results are scoped to the API key's tenant. Filter on any column with the operator suffixes documented on each parameter.`,
      'x-beaconhs-required-permission': readPermission,
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          description: `Page size (max ${MAX_LIMIT}).`,
        },
        {
          name: 'offset',
          in: 'query',
          schema: { type: 'integer', minimum: 0, default: 0 },
          description: 'Number of rows to skip.',
        },
        {
          name: 'sort',
          in: 'query',
          schema: { type: 'string', enum: columnKeys, default: entity.defaultSort?.column },
          description: 'Column to sort by.',
        },
        {
          name: 'order',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: entity.defaultSort?.direction ?? 'desc',
          },
          description: 'Sort direction.',
        },
        {
          name: 'fields',
          in: 'query',
          schema: { type: 'string' },
          description: 'Comma-separated subset of columns to return (default: all).',
        },
        ...filterParams,
      ],
      responses: {
        '200': {
          description: `A page of ${entity.label}.`,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: `#/components/schemas/${schemaName}` } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                  entity: { type: 'string', example: entity.key },
                },
                required: ['data', 'pagination'],
              },
            },
          },
        },
        '400': {
          description: 'Invalid request (unknown column or operator).',
          content: errorContent(),
        },
        '401': {
          description: 'Missing, invalid, revoked or expired API key.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
      },
    },
  }
  if (isWritable(entity.key)) operations.post = postOperation(entity)
  return operations
}

/** POST operation for a writable entity. */
function postOperation(entity: ReportEntity): Json {
  const schemaName = pascalCase(entity.key)
  const writePermission = writePermissionForEntity(entity.key)
  return {
    tags: [entity.category],
    operationId: `create_${entity.key}`,
    summary: `Create ${entity.label.replace(/s$/, '')}`,
    description: `Create a ${entity.label} record. Requires permission \`${writePermission}\`. The record is created in the API key's tenant.`,
    'x-beaconhs-required-permission': writePermission,
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: writeBodySchema(entity.key) ?? { type: 'object' } },
      },
    },
    responses: {
      '201': {
        description: `The created ${entity.label} record.`,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                entity: { type: 'string', example: entity.key },
                data: { $ref: `#/components/schemas/${schemaName}` },
              },
            },
          },
        },
      },
      '400': { description: 'Validation failed.', content: errorContent() },
      '401': {
        description: 'Missing, invalid, revoked or expired API key.',
        content: errorContent(),
      },
      '403': { description: 'API key lacks the required permission.', content: errorContent() },
    },
  }
}

/** GET-by-id operation for a recordable entity (physical table). */
function recordPath(entity: ReportEntity): Json {
  const schemaName = pascalCase(entity.key)
  const readPermission = readPermissionForEntity(entity)
  return {
    get: {
      tags: [entity.category],
      operationId: `get_${entity.key}`,
      summary: `Get ${entity.label.replace(/s$/, '')} by id`,
      description: `Fetch a single ${entity.label} record by id. Requires permission \`${readPermission}\`.`,
      'x-beaconhs-required-permission': readPermission,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: `The ${entity.label} record.`,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  entity: { type: 'string', example: entity.key },
                  data: { $ref: `#/components/schemas/${schemaName}` },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid id (not a uuid).', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No record with that id in your tenant.', content: errorContent() },
      },
    },
  }
}

export function buildOpenApiDocument(origin: string): Json {
  const schemas: Json = {
    Pagination: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        total: { type: 'integer', description: 'Total rows matching the filter.' },
        hasMore: { type: 'boolean' },
      },
      required: ['limit', 'offset', 'total', 'hasMore'],
    },
    ApiError: {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: {},
          },
          required: ['code', 'message'],
        },
      },
      required: ['error'],
    },
  }
  const paths: Json = {}
  for (const entity of REPORT_ENTITIES) {
    schemas[pascalCase(entity.key)] = entitySchema(entity)
    paths[`/api/v1/${entity.key}`] = entityPath(entity)
    if (isRecordable(entity.key)) {
      paths[`/api/v1/${entity.key}/{id}`] = recordPath(entity)
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'BeaconHS Public API',
      version: '1.0.0',
      description: [
        'REST access to your BeaconHS data, scoped to the tenant that owns the API key.',
        '',
        '## Authentication',
        'Send your key as a Bearer token:',
        '',
        '```',
        'Authorization: Bearer bhs_live_xxxxxxxx',
        '```',
        '',
        'Create and manage keys under Admin → API keys. The secret is shown once at creation.',
        '',
        '## Permissions',
        'API keys use the same permission catalogue as tenant roles. Each operation lists its required permission in the description and `x-beaconhs-required-permission`.',
        '',
        '## Filtering, sorting & paging',
        'Every list endpoint accepts `limit`, `offset`, `sort`, `order` and `fields`, plus per-column filters (`?status=open`, `?occurred_at__gte=2026-01-01`, `?severity__in=high,critical`).',
      ].join('\n'),
    },
    servers: [{ url: origin, description: 'This tenant' }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(REPORT_ENTITIES.map((e) => e.category))].map((c) => ({ name: c })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'A `bhs_live_…` key from Admin → API keys.',
        },
      },
      schemas,
    },
    paths,
  }
}
