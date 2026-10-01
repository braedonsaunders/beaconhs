import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'

describe('attachment reference indexes', () => {
  it('indexes every attachment pointer so deletion and signature invalidation avoid history scans', () => {
    const missing: string[] = []
    for (const table of Object.values(schema)) {
      if (!is(table, PgTable)) continue
      const config = getTableConfig(table)
      for (const column of config.columns.filter(
        (c) => c.name === 'attachment_id' || c.name.endsWith('_attachment_id'),
      )) {
        const indexed = config.indexes.some((index) => {
          const names = index.config.columns.map((c) => ('name' in c ? c.name : null))
          return names[0] === column.name || (names[0] === 'tenant_id' && names[1] === column.name)
        })
        if (!indexed) missing.push(`${config.name}.${column.name}`)
      }
    }
    expect(missing).toEqual([])
  })
})
