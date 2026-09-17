import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = new URL('../', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

/**
 * Drizzle renders a bare column chunk — `${table.column}` inside a sql`` —
 * WITHOUT its table qualifier. In a correlated subquery that is a trap: the
 * unqualified name binds to the INNER table when the inner table happens to
 * have a column of the same name.
 *
 * `sql`(select count(*) from ${tenantUsers} where ${tenantUsers.tenantId} = ${tenants.id})``
 * became `where tenant_id = id`, and `id` bound to tenant_users.id. Both are
 * uuid, so it never errored — /platform/tenants simply showed 0 members and
 * 0 people for every tenant while the real counts were in the hundreds. The
 * same shape on /platform/users compared text to uuid and took the page down.
 *
 * Use a grouped subquery joined with leftJoin instead, which drizzle aliases
 * and qualifies properly.
 */
describe('correlated subquery contract', () => {
  it('has no correlated count fragments built from bare column chunks', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => !file.endsWith('correlated-subquery-contract.test.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        return /select\s+count\(\*\)\s+from\s+\$\{/i.test(source)
          ? [file.slice(SOURCE_ROOT.length)]
          : []
      })
    expect(offenders).toEqual([])
  })
})
