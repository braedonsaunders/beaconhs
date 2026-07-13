// OpenAPI 3.1 document, generated from the reports entity registry so the spec
// can never drift from what /api/v1/[entity] actually serves. Hand-built plain
// objects (no extra dependency): every path, schema and filter parameter is
// derived from REPORT_ENTITIES.

import {
  REPORT_ENTITIES,
  type ReportColumnKind,
  type ReportEntity,
  type ReportEntityColumn,
} from '@beaconhs/reports'
import { DEFAULT_LIMIT, MAX_LIMIT } from './query'
import { readPermissionForEntity } from './permissions'
import { isRecordable } from './records'
import {
  BUILDER_APP_CREATE_PERMISSION,
  BUILDER_APP_DELETE_PERMISSION,
  BUILDER_APP_READ_PERMISSION,
  BUILDER_APP_UPDATE_PERMISSION,
  responseDataOpenApiSchema,
  type BuilderAppOpenApiEntity,
} from './builder-apps'
import {
  deletePermissionForEntity,
  isDeletable,
  isPatchable,
  isWritable,
  patchBodySchema,
  patchPermissionForEntity,
  writeBodySchema,
  writePermissionForEntity,
} from './write'

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
  const out = key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
  return out || 'Entity'
}

function operationSuffix(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'app'
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
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
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
    parameters: [idempotencyHeader()],
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
        description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
        content: errorContent(),
      },
      '403': { description: 'API key lacks the required permission.', content: errorContent() },
    },
  }
}

/** PATCH operation for a mutable entity. */
function patchOperation(entity: ReportEntity): Json {
  const schemaName = pascalCase(entity.key)
  const updatePermission = patchPermissionForEntity(entity.key)
  return {
    tags: [entity.category],
    operationId: `update_${entity.key}`,
    summary: `Update ${entity.label.replace(/s$/, '')}`,
    description: `Partially update a ${entity.label} record by id. Requires permission \`${updatePermission}\`. Lifecycle-specific actions that need extra workflow are not exposed through generic PATCH.`,
    'x-beaconhs-required-permission': updatePermission,
    security: [{ bearerAuth: [] }],
    parameters: [
      idempotencyHeader(),
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: patchBodySchema(entity.key) ?? { type: 'object' } },
      },
    },
    responses: {
      '200': {
        description: `The updated ${entity.label} record.`,
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
        description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
        content: errorContent(),
      },
      '403': { description: 'API key lacks the required permission.', content: errorContent() },
      '404': { description: 'No record with that id in your tenant.', content: errorContent() },
      '405': { description: 'Entity does not support PATCH.', content: errorContent() },
    },
  }
}

/** DELETE operation for a soft-deletable entity. */
function deleteOperation(entity: ReportEntity): Json {
  const deletePermission = deletePermissionForEntity(entity.key)
  return {
    tags: [entity.category],
    operationId: `delete_${entity.key}`,
    summary: `Delete ${entity.label.replace(/s$/, '')}`,
    description: `Soft-delete/archive a ${entity.label} record by id. Requires permission \`${deletePermission}\`.`,
    'x-beaconhs-required-permission': deletePermission,
    security: [{ bearerAuth: [] }],
    parameters: [
      idempotencyHeader(),
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      '200': {
        description: 'Delete result.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                entity: { type: 'string', example: entity.key },
                data: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    deleted: { type: 'boolean', example: true },
                    deletedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
      '400': { description: 'Invalid id or archived/locked record.', content: errorContent() },
      '401': {
        description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
        content: errorContent(),
      },
      '403': { description: 'API key lacks the required permission.', content: errorContent() },
      '404': { description: 'No record with that id in your tenant.', content: errorContent() },
      '405': { description: 'Entity does not support DELETE.', content: errorContent() },
    },
  }
}

function idempotencyHeader(): Json {
  return {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
    description: 'Unique retry key retained for 24 hours. Reusing it with another request is 409.',
  }
}

/** GET-by-id operation for a recordable entity (physical table). */
function recordPath(entity: ReportEntity): Json {
  const schemaName = pascalCase(entity.key)
  const readPermission = readPermissionForEntity(entity)
  const operations: Json = {
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
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No record with that id in your tenant.', content: errorContent() },
      },
    },
  }
  if (isPatchable(entity.key)) operations.patch = patchOperation(entity)
  if (isDeletable(entity.key)) operations.delete = deleteOperation(entity)
  return operations
}

function builderAppResponseSchema(dataSchema: Json | { $ref: string }): Json {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      template_id: { type: 'string', format: 'uuid' },
      template_key: { type: 'string' },
      template_name: { type: 'string' },
      template_version_id: { type: 'string', format: 'uuid' },
      template_version: { type: 'integer' },
      status: { type: 'string' },
      site_org_unit_id: { type: ['string', 'null'], format: 'uuid' },
      subject_person_id: { type: ['string', 'null'], format: 'uuid' },
      submitted_by: { type: ['string', 'null'], format: 'uuid' },
      submitted_at: { type: ['string', 'null'], format: 'date-time' },
      closed_at: { type: ['string', 'null'], format: 'date-time' },
      locked: { type: 'boolean' },
      compliance_score: { type: ['number', 'null'] },
      compliance_status: { type: ['string', 'null'] },
      monitor_status: { type: ['string', 'null'] },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
      data: dataSchema,
    },
    required: [
      'id',
      'template_id',
      'template_key',
      'template_name',
      'template_version_id',
      'template_version',
      'status',
      'locked',
      'created_at',
      'updated_at',
      'data',
    ],
  }
}

function builderAppSubmitSchema(dataSchema: Json | { $ref: string }): Json {
  return {
    type: 'object',
    required: ['data'],
    properties: {
      data: dataSchema,
      siteOrgUnitId: { type: 'string', format: 'uuid' },
      subjectPersonId: { type: 'string', format: 'uuid' },
      responseId: {
        type: 'string',
        format: 'uuid',
        description: 'Optional draft response id to finalize in-place.',
      },
    },
    additionalProperties: false,
  }
}

function builderAppPatchSchema(dataSchema: Json | { $ref: string }): Json {
  return {
    type: 'object',
    properties: {
      data: dataSchema,
      fields: {
        type: 'object',
        additionalProperties: true,
        description: 'Partial field map merged into the existing response data.',
      },
      siteOrgUnitId: { type: ['string', 'null'], format: 'uuid' },
      subjectPersonId: { type: ['string', 'null'], format: 'uuid' },
    },
    additionalProperties: false,
    minProperties: 1,
  }
}

function builderAppsPath(): Json {
  return {
    get: {
      tags: ['Builder apps'],
      operationId: 'list_builder_apps',
      summary: 'List published Builder apps',
      description: `List the tenant's published Builder apps and their dynamic response endpoints. Requires permission \`${BUILDER_APP_READ_PERMISSION}\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_READ_PERMISSION,
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'Published Builder apps for this tenant.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/BuilderApp' } },
                },
              },
            },
          },
        },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
      },
    },
  }
}

function builderResponsesPath(options: {
  app?: BuilderAppOpenApiEntity
  responseSchemaRef: string
  submitSchemaRef: string
}): Json {
  const suffix = options.app ? operationSuffix(options.app.key) : 'builder_app'
  const tag = options.app ? `Builder app: ${options.app.name}` : 'Builder apps'
  const templateParam = options.app
    ? []
    : [
        {
          name: 'templateKey',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Published Builder app key or template id.',
        },
      ]
  return {
    get: {
      tags: [tag],
      operationId: `list_${suffix}_responses`,
      summary: options.app ? `List ${options.app.name} responses` : 'List Builder app responses',
      description: `List responses for one published Builder app. Requires permission \`${BUILDER_APP_READ_PERMISSION}\`. Supports metadata filters plus exact data-field filters as \`data.field_id=value\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_READ_PERMISSION,
      ...(options.app ? { 'x-beaconhs-builder-app-key': options.app.key } : {}),
      security: [{ bearerAuth: [] }],
      parameters: [
        ...templateParam,
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
        },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        {
          name: 'sort',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['submitted_at', 'created_at', 'updated_at', 'status', 'compliance_score'],
            default: 'submitted_at',
          },
        },
        {
          name: 'order',
          in: 'query',
          schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'site_org_unit_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'subject_person_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'submitted_at__gte', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'submitted_at__lte', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'created_at__gte', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'created_at__lte', in: 'query', schema: { type: 'string', format: 'date-time' } },
      ],
      responses: {
        '200': {
          description: 'A page of Builder app responses.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  app: { type: 'string', example: options.app?.key ?? 'hot-work-permit' },
                  data: {
                    type: 'array',
                    items: { $ref: options.responseSchemaRef },
                  },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid request.', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No published Builder app with that key.', content: errorContent() },
      },
    },
    post: {
      tags: [tag],
      operationId: `submit_${suffix}_response`,
      summary: options.app ? `Submit ${options.app.name} response` : 'Submit Builder app response',
      description: `Validate and submit a response for one published Builder app. Runs the same scoring, participant indexing, audit, recap email, automation, and integration lifecycle as the app UI. Requires permission \`${BUILDER_APP_CREATE_PERMISSION}\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_CREATE_PERMISSION,
      ...(options.app ? { 'x-beaconhs-builder-app-key': options.app.key } : {}),
      security: [{ bearerAuth: [] }],
      parameters: [...templateParam, idempotencyHeader()],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: options.submitSchemaRef } } },
      },
      responses: {
        '201': {
          description: 'Submitted Builder app response.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  app: { type: 'string', example: options.app?.key ?? 'hot-work-permit' },
                  data: { $ref: options.responseSchemaRef },
                },
              },
            },
          },
        },
        '400': { description: 'Validation failed.', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No published Builder app with that key.', content: errorContent() },
      },
    },
  }
}

function builderResponseRecordPath(options: {
  app?: BuilderAppOpenApiEntity
  responseSchemaRef: string
  patchSchemaRef: string
}): Json {
  const suffix = options.app ? operationSuffix(options.app.key) : 'builder_app'
  const tag = options.app ? `Builder app: ${options.app.name}` : 'Builder apps'
  const templateParam = options.app
    ? []
    : [
        {
          name: 'templateKey',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Published Builder app key or template id.',
        },
      ]
  const idParam = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }
  return {
    get: {
      tags: [tag],
      operationId: `get_${suffix}_response`,
      summary: options.app ? `Get ${options.app.name} response` : 'Get Builder app response',
      description: `Fetch one Builder app response. Requires permission \`${BUILDER_APP_READ_PERMISSION}\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_READ_PERMISSION,
      ...(options.app ? { 'x-beaconhs-builder-app-key': options.app.key } : {}),
      security: [{ bearerAuth: [] }],
      parameters: [...templateParam, idParam],
      responses: {
        '200': {
          description: 'Builder app response.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  app: { type: 'string', example: options.app?.key ?? 'hot-work-permit' },
                  data: { $ref: options.responseSchemaRef },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid id.', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No response with that id.', content: errorContent() },
      },
    },
    patch: {
      tags: [tag],
      operationId: `update_${suffix}_response`,
      summary: options.app ? `Update ${options.app.name} response` : 'Update Builder app response',
      description: `Replace the response \`data\`, merge a partial \`fields\` object, or update response metadata. Revalidates the response and recomputes compliance. Requires permission \`${BUILDER_APP_UPDATE_PERMISSION}\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_UPDATE_PERMISSION,
      ...(options.app ? { 'x-beaconhs-builder-app-key': options.app.key } : {}),
      security: [{ bearerAuth: [] }],
      parameters: [...templateParam, idParam, idempotencyHeader()],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: options.patchSchemaRef } } },
      },
      responses: {
        '200': {
          description: 'Updated Builder app response.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  app: { type: 'string', example: options.app?.key ?? 'hot-work-permit' },
                  data: { $ref: options.responseSchemaRef },
                },
              },
            },
          },
        },
        '400': { description: 'Validation failed or response is locked.', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No response with that id.', content: errorContent() },
      },
    },
    delete: {
      tags: [tag],
      operationId: `delete_${suffix}_response`,
      summary: options.app ? `Delete ${options.app.name} response` : 'Delete Builder app response',
      description: `Soft-delete/archive one Builder app response. Requires permission \`${BUILDER_APP_DELETE_PERMISSION}\`.`,
      'x-beaconhs-required-permission': BUILDER_APP_DELETE_PERMISSION,
      ...(options.app ? { 'x-beaconhs-builder-app-key': options.app.key } : {}),
      security: [{ bearerAuth: [] }],
      parameters: [...templateParam, idParam, idempotencyHeader()],
      responses: {
        '200': {
          description: 'Delete result.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  app: { type: 'string', example: options.app?.key ?? 'hot-work-permit' },
                  data: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      template_key: { type: 'string' },
                      deleted: { type: 'boolean', example: true },
                      deleted_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid id or response is locked.', content: errorContent() },
        '401': {
          description: 'Missing, invalid, revoked or expired API key, or inactive workspace.',
          content: errorContent(),
        },
        '403': { description: 'API key lacks the required permission.', content: errorContent() },
        '404': { description: 'No response with that id.', content: errorContent() },
      },
    },
  }
}

export function buildOpenApiDocument(
  origin: string,
  options: {
    builderApps?: BuilderAppOpenApiEntity[]
    /** Per-entity tenant custom-field columns (keyed by entity key) to fold into
     *  the documented schema + query params. Supplied only on authenticated
     *  requests; the anonymous spec stays generic. */
    customColumns?: Record<string, ReportEntityColumn[]>
  } = {},
): Json {
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
            code: {
              type: 'string',
              enum: [
                'unauthorized',
                'forbidden',
                'not_found',
                'invalid_request',
                'method_not_allowed',
                'rate_limited',
                'conflict',
                'payload_too_large',
                'unavailable',
                'internal',
              ],
            },
            message: { type: 'string' },
            details: {},
          },
          required: ['code', 'message'],
        },
      },
      required: ['error'],
    },
    BuilderAppField: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string' },
        type: { type: 'string' },
        section_id: { type: 'string' },
        section_label: { type: ['string', 'null'] },
        required: { type: 'boolean' },
        repeating: { type: 'boolean' },
      },
    },
    BuilderApp: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        key: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
        kind: { type: 'string' },
        version: { type: 'integer' },
        endpoint: { type: 'string' },
        responses_endpoint: { type: 'string' },
        fields: { type: 'array', items: { $ref: '#/components/schemas/BuilderAppField' } },
      },
    },
    BuilderAppResponseData: { type: 'object', additionalProperties: true },
    BuilderAppResponse: builderAppResponseSchema({
      $ref: '#/components/schemas/BuilderAppResponseData',
    }),
    BuilderAppSubmitRequest: builderAppSubmitSchema({
      $ref: '#/components/schemas/BuilderAppResponseData',
    }),
    BuilderAppPatchRequest: builderAppPatchSchema({
      $ref: '#/components/schemas/BuilderAppResponseData',
    }),
  }
  const paths: Json = {}
  for (const baseEntity of REPORT_ENTITIES) {
    const extra = options.customColumns?.[baseEntity.key] ?? []
    const entity: ReportEntity = extra.length
      ? { ...baseEntity, columns: [...baseEntity.columns, ...extra] }
      : baseEntity
    schemas[pascalCase(entity.key)] = entitySchema(entity)
    paths[`/api/v1/${entity.key}`] = entityPath(entity)
    if (isRecordable(entity.key)) {
      paths[`/api/v1/${entity.key}/{id}`] = recordPath(entity)
    }
  }
  paths['/api/v1/apps'] = builderAppsPath()
  paths['/api/v1/apps/{templateKey}/responses'] = builderResponsesPath({
    responseSchemaRef: '#/components/schemas/BuilderAppResponse',
    submitSchemaRef: '#/components/schemas/BuilderAppSubmitRequest',
  })
  paths['/api/v1/apps/{templateKey}/responses/{id}'] = builderResponseRecordPath({
    responseSchemaRef: '#/components/schemas/BuilderAppResponse',
    patchSchemaRef: '#/components/schemas/BuilderAppPatchRequest',
  })

  for (const app of options.builderApps ?? []) {
    const name = `BuilderApp${pascalCase(app.key)}`
    schemas[`${name}ResponseData`] = responseDataOpenApiSchema(app.schema)
    schemas[`${name}Response`] = builderAppResponseSchema({
      $ref: `#/components/schemas/${name}ResponseData`,
    })
    schemas[`${name}SubmitRequest`] = builderAppSubmitSchema({
      $ref: `#/components/schemas/${name}ResponseData`,
    })
    schemas[`${name}PatchRequest`] = builderAppPatchSchema({
      $ref: `#/components/schemas/${name}ResponseData`,
    })
    const encodedKey = encodeURIComponent(app.key)
    paths[`/api/v1/apps/${encodedKey}/responses`] = builderResponsesPath({
      app,
      responseSchemaRef: `#/components/schemas/${name}Response`,
      submitSchemaRef: `#/components/schemas/${name}SubmitRequest`,
    })
    paths[`/api/v1/apps/${encodedKey}/responses/{id}`] = builderResponseRecordPath({
      app,
      responseSchemaRef: `#/components/schemas/${name}Response`,
      patchSchemaRef: `#/components/schemas/${name}PatchRequest`,
    })
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
        '## Builder apps',
        'Builder apps require both a forms permission and an explicit app grant on the API key. Fetch this document with a valid Bearer token to include only the concrete granted app paths and schemas.',
        '',
        '## Reliability and limits',
        'All POST, PATCH, and DELETE requests require an `Idempotency-Key` header. Keys are retained for 24 hours. Valid credentials are limited to 600 requests per minute; 429 responses include `Retry-After` and RateLimit headers.',
        '',
        '## Filtering, sorting & paging',
        'Every list endpoint accepts `limit`, `offset`, `sort`, `order` and `fields`, plus per-column filters (`?status=open`, `?occurred_at__gte=2026-01-01`, `?severity__in=high,critical`).',
      ].join('\n'),
    },
    servers: [{ url: origin, description: 'This tenant' }],
    security: [{ bearerAuth: [] }],
    tags: [
      ...[...new Set(REPORT_ENTITIES.map((e) => e.category))].map((c) => ({ name: c })),
      { name: 'Builder apps' },
      ...(options.builderApps ?? []).map((app) => ({ name: `Builder app: ${app.name}` })),
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'A `bhs_live_…` key from Admin → API keys.',
        },
      },
      responses: {
        RateLimited: {
          description: 'Valid API key exceeded 600 requests in the current minute.',
          headers: {
            'Retry-After': { schema: { type: 'integer' } },
            'RateLimit-Limit': { schema: { type: 'integer' } },
            'RateLimit-Remaining': { schema: { type: 'integer' } },
            'RateLimit-Reset': { schema: { type: 'integer' } },
          },
          content: errorContent(),
        },
        Unavailable: {
          description: 'Authorization dependency unavailable; requests fail closed.',
          headers: { 'Retry-After': { schema: { type: 'integer' } } },
          content: errorContent(),
        },
      },
      schemas,
    },
    paths,
  }
}
