import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { documentAcknowledgmentSessions, documentAcknowledgments, documentVersions } from './schema'

function indexColumns(table: Parameters<typeof getTableConfig>[0], name: string): string[] | null {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === name)
  return (
    index?.config.columns.map((column) =>
      'name' in column ? (column.name ?? 'expression') : 'expression',
    ) ?? null
  )
}

function foreignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): { child: string[]; parent: string[] } | null {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name)
  if (!key) return null
  const reference = key.reference()
  return {
    child: reference.columns.map((column) => column.name),
    parent: reference.foreignColumns.map((column) => column.name),
  }
}

describe('document acknowledgment relational integrity', () => {
  it('makes a document/version identity an addressable tenant key', () => {
    expect(indexColumns(documentVersions, 'document_versions_tenant_document_id_ux')).toEqual([
      'tenant_id',
      'document_id',
      'id',
    ])
  })

  it('binds every session and acknowledgment version to its own document', () => {
    expect(
      foreignKey(documentAcknowledgmentSessions, 'document_ack_sessions_tenant_doc_version_fk'),
    ).toEqual({
      child: ['tenant_id', 'document_id', 'version_id'],
      parent: ['tenant_id', 'document_id', 'id'],
    })
    expect(foreignKey(documentAcknowledgments, 'document_acks_tenant_doc_version_fk')).toEqual({
      child: ['tenant_id', 'document_id', 'version_id'],
      parent: ['tenant_id', 'document_id', 'id'],
    })
  })

  it('binds group acknowledgments to a session for the same document version', () => {
    expect(
      indexColumns(
        documentAcknowledgmentSessions,
        'document_ack_sessions_tenant_doc_version_id_ux',
      ),
    ).toEqual(['tenant_id', 'document_id', 'version_id', 'id'])
    expect(
      foreignKey(documentAcknowledgments, 'document_acks_tenant_doc_version_session_fk'),
    ).toEqual({
      child: ['tenant_id', 'document_id', 'version_id', 'session_id'],
      parent: ['tenant_id', 'document_id', 'version_id', 'id'],
    })
  })

  it('allows only one acknowledgment per person and immutable version', () => {
    expect(
      indexColumns(documentAcknowledgments, 'document_acks_tenant_doc_version_person_ux'),
    ).toEqual(['tenant_id', 'document_id', 'version_id', 'person_id'])
  })
})
