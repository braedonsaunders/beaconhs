import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  documentManagementReviewDocuments,
  documentManagementReviews,
  documentReviews,
} from './schema'
import { TENANT_SCOPED_TABLES } from './rls'

function foreignKeySignatures(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return config.foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference()
    return {
      name: foreignKey.getName(),
      columns: reference.columns.map((column) => column.name),
      parent: getTableConfig(reference.foreignTable).name,
      parentColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete ?? 'no action',
    }
  })
}

describe('document review version provenance', () => {
  it('requires every per-document review to identify one exact version', () => {
    const config = getTableConfig(documentReviews)
    expect(config.columns.find((column) => column.name === 'document_version_id')?.notNull).toBe(
      true,
    )
    expect(config.columns.find((column) => column.name === 'status')?.notNull).toBe(true)
    expect(config.columns.find((column) => column.name === 'outcome')?.notNull).toBe(false)
    expect(foreignKeySignatures(documentReviews)).toContainEqual({
      name: 'document_reviews_tenant_doc_version_fk',
      columns: ['tenant_id', 'document_id', 'document_version_id'],
      parent: 'document_versions',
      parentColumns: ['tenant_id', 'document_id', 'id'],
      onDelete: 'no action',
    })
  })

  it('normalizes management-review documents and pins exact versions tenant-safely', () => {
    const parent = getTableConfig(documentManagementReviews)
    expect(parent.columns.some((column) => column.name === 'documents_reviewed')).toBe(false)

    const child = getTableConfig(documentManagementReviewDocuments)
    expect(TENANT_SCOPED_TABLES).toContain('document_management_review_documents')
    expect(
      child.indexes.some(
        (index) =>
          index.config.name === 'document_management_review_documents_review_doc_ux' &&
          index.config.unique,
      ),
    ).toBe(true)
    expect(foreignKeySignatures(documentManagementReviewDocuments)).toEqual(
      expect.arrayContaining([
        {
          name: 'document_management_review_documents_tenant_review_fk',
          columns: ['tenant_id', 'management_review_id'],
          parent: 'document_management_reviews',
          parentColumns: ['tenant_id', 'id'],
          onDelete: 'cascade',
        },
        {
          name: 'document_management_review_documents_tenant_document_fk',
          columns: ['tenant_id', 'document_id'],
          parent: 'documents',
          parentColumns: ['tenant_id', 'id'],
          onDelete: 'no action',
        },
        {
          name: 'document_management_review_documents_tenant_doc_version_fk',
          columns: ['tenant_id', 'document_id', 'document_version_id'],
          parent: 'document_versions',
          parentColumns: ['tenant_id', 'document_id', 'id'],
          onDelete: 'no action',
        },
      ]),
    )
  })
})
