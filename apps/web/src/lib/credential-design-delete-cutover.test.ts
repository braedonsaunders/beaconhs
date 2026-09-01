import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), 'utf8')

describe('credential design delete cutover', () => {
  it('strips removed design ids from course pins on save', () => {
    const actions = read('../app/(app)/training/credential-designs/_actions.ts')
    const studio = read('../app/(app)/training/credential-designs/studio.tsx')
    expect(actions).toContain('removedIds')
    expect(actions).toContain('credentialOutputIds')
    expect(actions).toContain('trainingCourses')
    expect(studio).toContain('unpins it from every course')
  })
})
