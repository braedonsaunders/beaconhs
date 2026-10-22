import type { ModuleAdmin } from './registry'

/** Resolve the most specific section, including its nested editors and records. */
export function matchModuleManagementPath(modules: ModuleAdmin[], pathname: string) {
  let match: { module: ModuleAdmin; section: ModuleAdmin['sections'][number] } | undefined
  for (const config of modules) {
    for (const section of config.sections) {
      if (pathname !== section.href && !pathname.startsWith(`${section.href}/`)) continue
      if (!match || section.href.length > match.section.href.length)
        match = { module: config, section }
    }
  }
  return match
}

/** Preserve registry order within each group, gathering separated entries together. */
export function groupModuleManagementSections(sections: ModuleAdmin['sections']) {
  const groups = new Map<ModuleAdmin['sections'][number]['group'], ModuleAdmin['sections']>()
  for (const section of sections) {
    const items = groups.get(section.group) ?? []
    items.push(section)
    groups.set(section.group, items)
  }
  return [...groups].map(([label, items]) => ({ label, items }))
}
