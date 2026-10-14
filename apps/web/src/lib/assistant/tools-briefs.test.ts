import { describe, expect, it } from 'vitest'
import { canRunTool } from './gate'
import { BRIEF_TOOLS } from './tools-briefs'

function context(permissions: string[]) {
  return { isSuperAdmin: false, permissions: new Set(permissions) } as Parameters<
    typeof canRunTool
  >[0]
}

describe('assistant AI brief tools', () => {
  it('exposes brief tools only to people who can read briefs', () => {
    for (const tool of BRIEF_TOOLS) {
      expect(tool.category).toBe('read')
      expect(canRunTool(context(['assistant.use', 'briefs.read']), tool), tool.name).toBe(true)
      expect(canRunTool(context(['assistant.use', 'briefs.manage']), tool), tool.name).toBe(true)
      expect(canRunTool(context(['assistant.use', 'journals.read.all']), tool), tool.name).toBe(
        false,
      )
      expect(canRunTool(context(['briefs.read']), tool), tool.name).toBe(false)
    }
  })
})
